import { randomUUID } from "crypto";
import { collections } from "$lib/server/database";
import { config } from "$lib/server/config";
import { logger } from "$lib/server/logger";
import { onExit } from "$lib/server/exitHandler";
import { models } from "$lib/server/models";
import { buildSubtree } from "$lib/utils/tree/buildSubtree";
import { textGeneration } from "$lib/server/textGeneration";
import { isMlAssistantConversation } from "$lib/server/mlAssistant";
import { ML_ASSISTANT_EFFORT } from "$lib/constants/mlAssistant";
import { waitResumeResultText } from "$lib/server/textGeneration/builtinTools/waitTool";
import { ToolResultStatus } from "$lib/types/Tool";
import {
	MessageToolUpdateType,
	MessageUpdateStatus,
	MessageUpdateType,
	type MessageUpdate,
} from "$lib/types/MessageUpdate";
import type { ParkedCall } from "$lib/types/ParkedCall";
import type { TextGenerationContext } from "$lib/server/textGeneration/types";
import { createGenerationWriter } from "./writer";
import { applyUpdateToMessage } from "./applyUpdate";
import { turnAbandoned, turnEnded, turnRunning } from "./turnState";
import { compressUpdatesForStorage } from "./compressUpdates";

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

/**
 * Bump the claim's lease while the resume is still working. Guarded on the
 * status so a renewal racing the finally's `resumed` write can never revive a
 * finished row.
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
async function rebuildIdentity(park: ParkedCall) {
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
					messages: conv.messages.map((m) => ({
						...m,
						updates: compressUpdatesForStorage(m.updates),
					})),
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
					? settings?.providerOverrides?.[model.id]
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
	} finally {
		await persist();
		await writer.finish({ status: hasError ? "error" : "completed" });
		await collections.parkedCalls.updateOne(
			{ _id: park._id },
			{ $set: { status: "resumed", resumedAt: new Date(), updatedAt: new Date() } }
		);
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
