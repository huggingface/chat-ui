import { randomUUID } from "crypto";
import { MongoInvalidArgumentError, MongoServerError } from "mongodb";
import { collections } from "$lib/server/database";
import { config } from "$lib/server/config";
import { logger } from "$lib/server/logger";
import { onExit } from "$lib/server/exitHandler";
import { models } from "$lib/server/models";
import { buildSubtree } from "$lib/utils/tree/buildSubtree";
import { textGeneration } from "$lib/server/textGeneration";
import { isMlAssistantConversation } from "$lib/server/mlAssistant";
import { mlAssistantProviderFor } from "$lib/server/mlAssistantModels";
import { ML_ASSISTANT_EFFORT } from "$lib/constants/mlAssistant";
import { waitResumeResultText } from "$lib/server/textGeneration/builtinTools/waitTool";
import { ToolResultStatus } from "$lib/types/Tool";
import {
	MessageElicitationUpdateType,
	MessageToolUpdateType,
	MessageUpdateStatus,
	MessageUpdateType,
	type MessageUpdate,
} from "$lib/types/MessageUpdate";
import type { ParkedCall } from "$lib/types/ParkedCall";
import type { TextGenerationContext } from "$lib/server/textGeneration/types";
import { createGenerationWriter } from "./writer";
import { applyUpdateToMessage } from "./applyUpdate";
import { turnAbandoned, turnEnded, turnRunning, turnUnsaved } from "./turnState";
import { compressUpdatesForStorage, messageForStorage } from "./compressUpdates";
import { restoreRunningShape } from "./messageShape";

const SWEEP_BATCH = 5;
/** A row this many attempts deep is not going to resume; stop burning turns on it. */
const MAX_ATTEMPTS = 3;

function sweepIntervalMs(): number {
	const raw = config.PARKED_SWEEP_INTERVAL_MS;
	const parsed = raw ? parseInt(raw, 10) : NaN;
	return !isNaN(parsed) && parsed > 0 ? parsed : 10_000;
}

/**
 * How long a claim holds a row before another sweeper may take it. A resume that
 * dies between the claim and its own error handling — or a pod that dies at any
 * point — would otherwise strand the row in `resuming` until the TTL removed it,
 * and `attempts` would never reach the retry ceiling it exists to enforce.
 */
const CLAIM_LEASE_MS = 5 * 60_000;

/**
 * A LIVE resume renews its claim on this cadence (see resumeParkedCall), so the
 * lease only ever expires under a producer that actually died. Well under
 * CLAIM_LEASE_MS: several consecutive renewals must all fail before a row can
 * be stolen from a running resume.
 */
const LEASE_RENEW_MS = 60_000;

const TOO_LARGE_REASON = "the conversation is too large to save (MongoDB's 16 MiB document limit)";
const TOO_LARGE_ERROR =
	"This conversation has grown too large to save, so the work from this turn could not be kept. " +
	"Start a new conversation to continue.";

/**
 * A conversation write MongoDB will refuse however often it is retried. Matched
 * on `code`: an update's write error carries no `codeName`.
 */
export function isDocumentTooLarge(err: unknown): boolean {
	if (err instanceof MongoServerError) {
		// 10334 BSONObjectTooLarge (the document, or the command carrying it);
		// 17419 an update whose result would outgrow the limit.
		return err.code === 10334 || err.code === 17419;
	}
	if (err instanceof MongoInvalidArgumentError) {
		return /larger than the maximum size/i.test(err.message);
	}
	// bson serialises into a fixed 17 MiB buffer and overruns it with Node's own
	// bounds error, before the driver's size checks run.
	return err instanceof RangeError && "code" in err && err.code === "ERR_OUT_OF_RANGE";
}

/**
 * Questions an unsaved run left open would still take an answer, and the answer
 * starts a run into the same unwritable document. Expiry is the one close an
 * answer cannot replace (submitElicitationAnswer lets a user's answer stand in
 * for any other close nothing consumed); the TTL index removes the row later.
 */
async function expireUnsavedPrompts(
	park: ParkedCall,
	generationId: string
): Promise<MessageUpdate[]> {
	const closed: MessageUpdate[] = [];
	try {
		const open = await collections.mcpElicitations
			.find(
				{
					conversationId: park.conversationId,
					generationId,
					"pending.messageId": park.messageId,
					status: "pending",
				},
				{ projection: { elicitationId: 1 } }
			)
			.toArray();
		for (const { _id, elicitationId } of open) {
			const now = new Date();
			const result = await collections.mcpElicitations.updateOne(
				{ _id, status: "pending" },
				{ $set: { expiresAt: now, updatedAt: now } }
			);
			if (result.matchedCount === 0) continue;
			closed.push({
				type: MessageUpdateType.Elicitation,
				subtype: MessageElicitationUpdateType.Resolved,
				elicitationId,
				action: "cancel",
				resolution: "expired",
			});
		}
	} catch (err) {
		logger.error(
			{ err, parkedCallId: park.parkedCallId },
			"[parked] failed to expire questions of an unsaved turn"
		);
	}
	return closed;
}

/**
 * Bump the claim's lease while the resume is still working. Guarded on the
 * status so a renewal racing the `resumed` write can never revive a finished
 * row.
 */
export async function renewClaim(park: ParkedCall): Promise<void> {
	const now = new Date();
	await collections.parkedCalls
		.updateOne({ _id: park._id, status: "resuming" }, { $set: { takenAt: now, updatedAt: now } })
		.catch((err) =>
			logger.warn({ err, parkedCallId: park.parkedCallId }, "[parked] failed to renew claim lease")
		);
}

/**
 * Claim one due row. The filter carries the status, so two pods racing on the
 * same row produce one winner and one miss rather than two resumed turns. A
 * claim whose lease has expired is fair game again, which is what makes the
 * attempt counter meaningful.
 */
async function claimDueCall(now: Date): Promise<ParkedCall | null> {
	const claimed = await collections.parkedCalls.findOneAndUpdate(
		{
			resumeAt: { $lte: now },
			$or: [
				{ status: "waiting" },
				{ status: "resuming", takenAt: { $lt: new Date(now.getTime() - CLAIM_LEASE_MS) } },
			],
		},
		{ $set: { status: "resuming", takenAt: now, updatedAt: now }, $inc: { attempts: 1 } },
		{ sort: { resumeAt: 1 }, returnDocument: "after" }
	);
	// Driver v5: findOneAndUpdate returns ModifyResult unless told otherwise.
	return claimed?.value ?? null;
}

/**
 * Cut a wait short because the user asked to: they can see what the turn is
 * waiting for and often know it is worth a look before the timer is up.
 *
 * Moving the deadline is the ENTIRE state change. The row stays `waiting`, so
 * the ordinary claim still decides which pod resumes it and a racing sweeper
 * cannot produce a second producer for the turn. The caller kicks a sweep
 * afterwards purely so the user does not sit through the sweep interval.
 */
export async function wakeParkedCallEarly(
	conversationId: ParkedCall["conversationId"],
	messageId: string
): Promise<boolean> {
	const now = new Date();
	// A pipeline update so the deadline the model asked for is kept in the same
	// atomic write that overwrites it — the resumed round needs both to say how
	// much of the wait was skipped.
	const result = await collections.parkedCalls.updateOne(
		{ conversationId, messageId, status: "waiting" },
		[
			{
				$set: {
					// a harness wake may already have moved resumeAt
					plannedResumeAt: { $ifNull: ["$plannedResumeAt", "$resumeAt"] },
					resumeAt: now,
					wokeEarlyAt: now,
					updatedAt: now,
				},
			},
		]
	);
	if (result.matchedCount === 0) return false;
	logger.info(
		{ conversationId: conversationId.toString(), messageId },
		"[parked] user asked to wake a parked turn early"
	);
	return true;
}

async function abandon(park: ParkedCall, reason: string): Promise<void> {
	logger.warn({ parkedCallId: park.parkedCallId, reason }, "[parked] abandoning a parked call");
	await collections.parkedCalls.updateOne(
		{ _id: park._id },
		{ $set: { status: "abandoned", abandonedReason: reason, updatedAt: new Date() } }
	);
	// Close the turn too: nothing will resume it, and a `waiting` state doc
	// would read alive forever (see turnAbandoned). Persisting the terminal
	// state into the message is what lets the next snapshot clear the wait
	// banner — and makes the failed turn eligible for the Resume affordance.
	const failedUpdate = await turnAbandoned(
		park.conversationId,
		park.messageId,
		`The turn was abandoned: ${reason}.`
	);
	if (failedUpdate) {
		await collections.conversations
			.updateOne({ _id: park.conversationId, "messages.id": park.messageId }, {
				$push: { "messages.$.updates": failedUpdate },
				$set: { "messages.$.updatedAt": new Date(), updatedAt: new Date() },
			} as never)
			.catch((err) =>
				logger.error(
					{ err, parkedCallId: park.parkedCallId },
					"[parked] failed to persist the abandoned turn state"
				)
			);
	}
}

/**
 * Rebuild the identity the parked turn ran as. There is no request to read one
 * from, so it comes from the row and the stored session — which also means a
 * resume can only ever act as the user who parked it.
 *
 * An expired token is not a reason to drop the turn: the model is told, in the
 * tool result, so it can say so rather than failing opaquely on the first call.
 */
export async function rebuildIdentity(park: Pick<ParkedCall, "userId" | "sessionId">) {
	const user = park.userId
		? ((await collections.users.findOne({ _id: park.userId })) ?? undefined)
		: undefined;

	const session = park.userId
		? await collections.sessions.find({ userId: park.userId }).sort({ updatedAt: -1 }).next()
		: park.sessionId
			? await collections.sessions.findOne({ sessionId: park.sessionId })
			: null;

	const token = session?.oauth?.token;
	const tokenExpired = Boolean(token?.expiresAt && token.expiresAt.getTime() <= Date.now());
	const settings = await collections.settings.findOne(
		park.userId ? { userId: park.userId } : { sessionId: park.sessionId ?? "" }
	);

	return {
		locals: {
			user,
			sessionId: session?.sessionId ?? park.sessionId ?? "",
			isAdmin: false,
			...(token?.value && !tokenExpired ? { token: token.value } : {}),
			...(settings?.billingOrganization
				? { billingOrganization: settings.billingOrganization }
				: {}),
			...(settings?.billingResourceGroup
				? { billingResourceGroup: settings.billingResourceGroup }
				: {}),
		} as unknown as App.Locals,
		settings,
		tokenExpired: tokenExpired || !token?.value,
	};
}

/** Wake one parked turn: inject the tool result it parked on, then let it continue. */
export async function resumeParkedCall(park: ParkedCall): Promise<void> {
	// The claim lease exists to recover a resume whose pod DIED — but a live
	// resumed run routinely outlives it (an ML continuation runs for tens of
	// minutes). Without renewal the sweeper re-claims the row every
	// CLAIM_LEASE_MS and launches a second producer onto the same turn:
	// dueling writers over one seq range, interleaved turn states (a stale
	// `waiting` landing after the live `running` is the stuck wait banner),
	// and after MAX_ATTEMPTS the row is abandoned mid-run.
	const leaseRenewer = setInterval(() => void renewClaim(park), LEASE_RENEW_MS);
	leaseRenewer.unref?.();
	try {
		await resumeParkedCallInner(park);
	} finally {
		clearInterval(leaseRenewer);
	}
}

async function resumeParkedCallInner(park: ParkedCall): Promise<void> {
	const conv = await collections.conversations.findOne({ _id: park.conversationId });
	if (!conv) return abandon(park, "conversation is gone");

	const message = conv.messages.find((m) => m.id === park.messageId);
	if (!message || message.from !== "assistant") {
		return abandon(park, "no parked assistant message to resume");
	}

	const model = models.find((m) => m.id === conv.model);
	if (!model) return abandon(park, `model ${conv.model} is no longer available`);

	const { locals, settings, tokenExpired } = await rebuildIdentity(park);

	const generationId = randomUUID();
	restoreRunningShape(message);
	const initialContent = message.content;
	const promptedAt = new Date();
	const abortController = new AbortController();

	// The browser finds a running turn through the last assistant message's
	// generationId. A resumed run that leaves the parked turn's id in place is
	// invisible: its output only appears on a manual refresh.
	message.generationId = generationId;
	await collections.conversations.updateOne(
		{ _id: conv._id, "messages.id": message.id },
		{ $set: { "messages.$.generationId": generationId, updatedAt: new Date() } }
	);

	const writer = await createGenerationWriter({
		generationId,
		conversationId: conv._id,
		messageId: message.id,
		continueFromSeq: message.materializedSeq,
		...(park.userId ? { userId: park.userId } : {}),
		...(locals.sessionId ? { sessionId: locals.sessionId } : {}),
		snapshot: () => ({
			content: message.content,
			reasoning: message.reasoning,
			files: message.files,
			routerMetadata: message.routerMetadata,
			updates: compressUpdatesForStorage(message.updates),
		}),
	});

	const apply = (event: MessageUpdate) => {
		const applied = applyUpdateToMessage(event, {
			message,
			conv,
			initialContent,
			isRouterModel: Boolean(model.isRouter),
		});
		if (applied.skipped) return;
		writer.push(event);
	};

	const persist = async () => {
		message.materializedSeq = writer.currentSeq();
		await collections.conversations.updateOne(
			{ _id: conv._id },
			{
				$set: {
					messages: conv.messages.map(messageForStorage),
					title: conv.title,
					updatedAt: new Date(),
				},
			}
		);
	};

	// This producer holds the turn from here; the terminal write below is a CAS
	// that leaves a park recorded mid-run standing. Same vocabulary as the route.
	const turnKey = {
		conversationId: conv._id,
		messageId: message.id,
		producerId: generationId,
		...(park.userId ? { userId: park.userId } : {}),
		...(locals.sessionId ? { sessionId: locals.sessionId } : {}),
	};

	let hasError = false;
	try {
		apply(await turnRunning(turnKey));

		// A re-claim after a pod died mid-resume finds the result already stored,
		// followed by whatever that run did next; the turn carries on from there.
		const delivered = (message.updates ?? []).some(
			(u) =>
				u.type === MessageUpdateType.Tool &&
				(u.subtype === MessageToolUpdateType.Result || u.subtype === MessageToolUpdateType.Error) &&
				u.uuid === park.toolUuid
		);
		if (delivered) {
			logger.info(
				{ parkedCallId: park.parkedCallId, attempt: park.attempts },
				"[parked] wait result already delivered; continuing the stored turn"
			);
		} else {
			// The result the parked call has been missing. Replay pairs it with the call
			// by uuid, which is what puts it in the model's history for the next round.
			apply({
				type: MessageUpdateType.Tool,
				subtype: MessageToolUpdateType.Result,
				uuid: park.toolUuid,
				result: {
					status: ToolResultStatus.Success,
					call: { name: "wait", parameters: {} },
					outputs: [
						{
							text:
								waitResumeResultText(park) +
								(tokenExpired
									? " NOTE: the signed-in session expired while you waited, so Hub tools may " +
										"be unauthenticated. If one fails that way, say so rather than retrying."
									: ""),
						},
					] as unknown as Record<string, unknown>[],
					display: true,
				},
			});
		}

		const ctx: TextGenerationContext = {
			model,
			endpoint: await model.getEndpoint(),
			conv,
			messages: buildSubtree(conv, message.id),
			promptedAt,
			ip: "sweeper",
			username: locals.user?.username,
			provider:
				config.isHuggingChat && !model.isRouter
					? isMlAssistantConversation(conv)
						? mlAssistantProviderFor(model.id, settings?.providerOverrides?.[model.id])
						: settings?.providerOverrides?.[model.id]
					: undefined,
			reasoningEffort: isMlAssistantConversation(conv)
				? ML_ASSISTANT_EFFORT
				: settings?.reasoningEffortOverrides?.[model.id],
			reasoningOverride: settings?.reasoningOverrides?.[model.id],
			artifactsOverride: settings?.artifactsOverrides?.[model.id],
			locals,
			abortController,
			generationId,
			messageId: message.id,
		};

		for await (const event of textGeneration(ctx)) apply(event);
		// A resumed turn may park again — on another wait, or on a question. Either
		// way this run's lifecycle closes with `finished`, matching what the route
		// does when a fresh turn parks: the client derives liveness from the LAST
		// lifecycle event (see generationState.ts), so the next resume's `started`
		// is what reopens the message, and a parked one reads terminal — the same
		// from every producer. Leaving `started` as the last event here instead
		// made a reloading client reattach to the already-ended generation in a
		// refresh loop.
		apply({ type: MessageUpdateType.Status, status: MessageUpdateStatus.Finished });
		// CAS: misses when the resumed run parked again, and that state stands.
		const endedUpdate = await turnEnded(turnKey, { failed: false });
		if (endedUpdate) apply(endedUpdate);
	} catch (err) {
		hasError = true;
		logger.error({ err, parkedCallId: park.parkedCallId }, "[parked] resumed turn failed");
		const errorMessage = err instanceof Error ? err.message : "The resumed turn failed.";
		apply({
			type: MessageUpdateType.Status,
			status: MessageUpdateStatus.Error,
			message: errorMessage,
		});
		const failedUpdate = await turnEnded(turnKey, { failed: true, error: errorMessage });
		if (failedUpdate) apply(failedUpdate);
	}

	// Settled before the save: the run is over, so a re-claim could only repeat
	// it, re-billing every model and tool call. A save that throws, or a pod
	// that dies inside it, must not hand the row back to the lease.
	await collections.parkedCalls
		.updateOne(
			{ _id: park._id },
			{ $set: { status: "resumed", resumedAt: new Date(), updatedAt: new Date() } }
		)
		.catch((err) =>
			logger.error({ err, parkedCallId: park.parkedCallId }, "[parked] failed to settle the row")
		);

	try {
		await persist();
	} catch (err) {
		if (!isDocumentTooLarge(err)) {
			logger.error(
				{ err, parkedCallId: park.parkedCallId, conversationId: conv._id.toString() },
				"[parked] failed to save the resumed turn"
			);
		} else {
			hasError = true;
			logger.error(
				{ err, parkedCallId: park.parkedCallId, conversationId: conv._id.toString() },
				"[parked] conversation too large to save; abandoning the resumed turn"
			);
			// Parks this run recorded too: each would resume into the same
			// unwritable document and spend a whole run before failing here again.
			await collections.parkedCalls
				.updateMany(
					{
						$or: [
							{ _id: park._id },
							{
								conversationId: park.conversationId,
								messageId: park.messageId,
								generationId,
								status: "waiting",
							},
						],
					},
					{
						$set: { status: "abandoned", abandonedReason: TOO_LARGE_REASON, updatedAt: new Date() },
					}
				)
				.catch((abandonErr) =>
					logger.error(
						{ err: abandonErr, parkedCallId: park.parkedCallId },
						"[parked] failed to abandon parked calls of an unsaved turn"
					)
				);
			for (const closed of await expireUnsavedPrompts(park, generationId)) apply(closed);
			apply({
				type: MessageUpdateType.Status,
				status: MessageUpdateStatus.Error,
				message: TOO_LARGE_ERROR,
			});
			const failedUpdate = await turnUnsaved(turnKey, TOO_LARGE_ERROR);
			if (failedUpdate) apply(failedUpdate);
		}
	} finally {
		await writer.finish({ status: hasError ? "error" : "completed" });
	}
}

export async function sweepParkedCalls(): Promise<void> {
	for (let i = 0; i < SWEEP_BATCH; i += 1) {
		const park = await claimDueCall(new Date());
		if (!park) return;
		if (park.attempts > MAX_ATTEMPTS) {
			await abandon(park, `gave up after ${park.attempts} attempts`);
			continue;
		}
		logger.info(
			{ parkedCallId: park.parkedCallId, reason: park.reason, attempt: park.attempts },
			"[parked] resuming a parked turn"
		);
		await resumeParkedCall(park).catch((err) =>
			logger.error({ err, parkedCallId: park.parkedCallId }, "[parked] sweep failed")
		);
	}
}

export class ParkedCallSweeper {
	private static instance: ParkedCallSweeper;

	private constructor() {
		const interval = setInterval(() => {
			sweepParkedCalls().catch((err) => logger.error({ err }, "[parked] sweep failed"));
		}, sweepIntervalMs());
		interval.unref?.();
		onExit(() => clearInterval(interval));
	}

	public static getInstance(): ParkedCallSweeper {
		if (!ParkedCallSweeper.instance) {
			ParkedCallSweeper.instance = new ParkedCallSweeper();
		}
		return ParkedCallSweeper.instance;
	}
}
