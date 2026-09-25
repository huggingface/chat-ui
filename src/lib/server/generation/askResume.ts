import { randomUUID } from "crypto";
import type { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import { config } from "$lib/server/config";
import { logger } from "$lib/server/logger";
import { onExit } from "$lib/server/exitHandler";
import { models } from "$lib/server/models";
import { AbortRegistry } from "$lib/server/abortRegistry";
import { buildSubtree } from "$lib/utils/tree/buildSubtree";
import { textGeneration } from "$lib/server/textGeneration";
import { isMlAssistantConversation } from "$lib/server/mlAssistant";
import { mlAssistantProviderFor } from "$lib/server/mlAssistantModels";
import { ML_ASSISTANT_EFFORT } from "$lib/constants/mlAssistant";
import {
	RESUME_LEASE_MS,
	claimElicitationResume,
	finishElicitationResume,
	releaseElicitationResume,
} from "$lib/server/mcp/elicitation";
import { resumeParkedToolCall } from "$lib/server/mcp/resumeElicitation";
import {
	MessageElicitationUpdateType,
	MessageToolUpdateType,
	MessageUpdateStatus,
	MessageUpdateType,
	type MessageUpdate,
} from "$lib/types/MessageUpdate";
import type { Conversation } from "$lib/types/Conversation";
import type { McpElicitation } from "$lib/types/McpElicitation";
import type { Message } from "$lib/types/Message";
import type { TextGenerationContext } from "$lib/server/textGeneration/types";
import type { McpServerConfig } from "$lib/server/mcp/httpClient";
import { createGenerationWriter } from "./writer";
import { isTurnAlive } from "./turnLog";
import { clearStaleStopMarker, watchStopMarker } from "./stopMarker";
import { applyUpdateToMessage } from "./applyUpdate";
import { rebuildIdentity } from "./parkedSweeper";
import {
	turnAbandoned,
	turnAnsweredWithoutRun,
	turnAwaitingInput,
	turnEnded,
	turnRunning,
} from "./turnState";
import { compressUpdatesForStorage, messageForStorage } from "./compressUpdates";
import { restoreRunningShape } from "$lib/utils/messageShape";

const SWEEP_BATCH = 5;
/** A row this many claims deep is not going to store its result; stop trying. */
const MAX_ATTEMPTS = 3;

/**
 * The answer endpoint starts the continuation itself, so the sweep only exists for answers
 * whose process died first. The delay keeps it off rows that endpoint is still working on,
 * and — during a deploy — off an answer an old pod recorded and an old client is about to
 * resume through the route, which that pod runs without taking the claim.
 */
const SWEEP_GRACE_MS = 30_000;

/**
 * Recovery is for recent answers. Without a bound, the first sweep after this ships would
 * wake every answer the browser-driven resume ever dropped — weeks of them, each an ML turn
 * that may submit paid jobs for a user who left long ago. Older rows still get their result
 * (see settleAnsweredAsks) and resume if the user answers again.
 */
const SWEEP_MAX_AGE_MS = 60 * 60_000;

function sweepIntervalMs(): number {
	const raw = config.PARKED_SWEEP_INTERVAL_MS;
	const parsed = raw ? parseInt(raw, 10) : NaN;
	return !isNaN(parsed) && parsed > 0 ? parsed : 10_000;
}

const alreadySettled = (message: Message, elicitationId: string): boolean =>
	(message.updates ?? []).some(
		(update) =>
			update.type === MessageUpdateType.Elicitation &&
			update.subtype === MessageElicitationUpdateType.Resolved &&
			update.elicitationId === elicitationId
	);

/**
 * Whether a run carried on after the answer was delivered: anything in the transcript past
 * the Resolved row other than the delivery itself (the call's result, turn-state marks).
 * Delivery without this is a holder that died before calling the model, and is safe — is
 * owed — a run; delivery WITH it is a turn that must never be run again, whoever ran it.
 */
function ranPastAnswer(message: Message, row: McpElicitation): boolean {
	const updates = message.updates ?? [];
	const delivered = updates.findIndex(
		(update) =>
			update.type === MessageUpdateType.Elicitation &&
			update.subtype === MessageElicitationUpdateType.Resolved &&
			update.elicitationId === row.elicitationId
	);
	if (delivered === -1) return false;
	return updates
		.slice(delivered + 1)
		.some(
			(update) =>
				update.type !== MessageUpdateType.TurnState &&
				!(
					update.type === MessageUpdateType.Tool &&
					update.subtype === MessageToolUpdateType.Result &&
					update.uuid === row.pending?.toolUuid
				)
		);
}

/** The Resolved row and the tool Result the parked call has been missing. */
async function answerUpdates(row: McpElicitation): Promise<MessageUpdate[]> {
	const outcome = await resumeParkedToolCall({
		conversationId: row.conversationId,
		elicitationId: row.elicitationId,
		claimed: row,
	});
	return outcome.updates;
}

async function abandon(row: McpElicitation, reason: string): Promise<void> {
	logger.warn(
		{ elicitationId: row.elicitationId, reason },
		"[ask] abandoning an answered question"
	);
	await finishElicitationResume(row, { abandoned: reason });
	const messageId = row.pending?.messageId;
	if (!messageId) return;
	// Nothing will continue the turn, and an `awaiting_input` state would read alive forever.
	const failedUpdate = await turnAbandoned(
		row.conversationId,
		messageId,
		`The turn was abandoned: ${reason}.`,
		["awaiting_input", "running"]
	);
	if (failedUpdate) {
		await collections.conversations
			.updateOne({ _id: row.conversationId, "messages.id": messageId }, {
				$push: { "messages.$.updates": failedUpdate },
				$set: { "messages.$.updatedAt": new Date(), updatedAt: new Date() },
			} as never)
			.catch((err) =>
				logger.error(
					{ err, elicitationId: row.elicitationId },
					"[ask] failed to persist the abandoned turn state"
				)
			);
	}
}

/**
 * The tool selection the answering browser holds, as the message route receives it. It
 * travels with the answer rather than being recorded when the question parks: a custom
 * server's headers can carry the user's credentials, which live in their browser and are
 * never written to the database. So the sweep has none, and a turn it recovers runs on the
 * configured servers plus the preset, as a parked wait's resume does.
 */
export interface AskResumeSelection {
	selectedServerNames?: string[];
	selectedServers?: McpServerConfig[];
	timezone?: string;
}

export type AskResumeOutcome =
	/** Another caller holds or has consumed the claim; nothing was done here. */
	| "not_claimed"
	/** Something that holds no claim is continuing the turn, or already did. */
	| "already_continued"
	| "abandoned"
	/** The result was stored; the turn was not run because the conversation has moved on. */
	| "answered"
	/** The result was stored and the turn is running. */
	| "resumed";

/**
 * Continue the turn an answered `ask_user_question` parked, with no request behind it.
 *
 * Resolves once the answer is stored and the claim consumed; `run` settles when the
 * continued turn ends. Callers must not hold a request open on `run`: the point is that the
 * turn no longer depends on the browser that answered.
 */
export async function resumeAnsweredAsk({
	conversationId,
	elicitationId,
	selection,
}: {
	conversationId: ObjectId;
	elicitationId: string;
	selection?: AskResumeSelection;
}): Promise<{ outcome: AskResumeOutcome; run?: Promise<void> }> {
	// Asks only: a parked MCP call is re-issued against a server that may exist only in the
	// browser's configuration, so its continuation still starts from the route.
	const row = await claimElicitationResume(conversationId, elicitationId, "ask");
	const pending = row?.pending;
	if (!row || !pending) return { outcome: "not_claimed" };

	const conv = await collections.conversations.findOne({ _id: conversationId });
	if (!conv) {
		await abandon(row, "conversation is gone");
		return { outcome: "abandoned" };
	}
	const message = conv.messages.find((m) => m.id === pending.messageId);
	if (!message || message.from !== "assistant") {
		await abandon(row, "no parked assistant message to resume");
		return { outcome: "abandoned" };
	}

	// Continuations that hold no claim: every one the browser drove before claims existed,
	// an old pod's during a deploy, and one of ours whose consuming write failed. The claim
	// cannot see them; the transcript can. Without this the first sweep after shipping would
	// re-run every question answered in the last hour.
	if (ranPastAnswer(message, row)) {
		await finishElicitationResume(row);
		return { outcome: "already_continued" };
	}
	// Same producers, caught before they have stored anything. Released uncounted: nothing
	// failed, and counting would walk a healthy turn up to the ceiling and abandon it.
	const turn = await isTurnAlive(conversationId, message.id);
	if (turn.alive && turn.status === "running") {
		await releaseElicitationResume(row, { uncounted: true });
		return { outcome: "already_continued" };
	}

	if ((row.resume?.attempts ?? 0) > MAX_ATTEMPTS) {
		await abandon(row, `gave up after ${row.resume?.attempts} attempts`);
		return { outcome: "abandoned" };
	}

	// The user sent something else since: that turn owns the conversation now, a run here
	// would be one nobody is watching, and its final save would race the newer turn's. The
	// answer still goes on record so the model reads it in history.
	if ((message.children?.length ?? 0) > 0) {
		await storeAnswerOnly(conv, message, row);
		return { outcome: "answered" };
	}

	const model = models.find((m) => m.id === conv.model);
	if (!model) {
		await abandon(row, `model ${conv.model} is no longer available`);
		return { outcome: "abandoned" };
	}

	const { locals, settings } = await rebuildIdentity({
		...(conv.userId ? { userId: conv.userId } : {}),
		...(conv.sessionId ? { sessionId: conv.sessionId } : {}),
	});

	// Without it the resumed round loses servers only the browser knows and regains ones the
	// user switched off, so the model can find its tools changed mid-turn.
	if (selection?.selectedServerNames || selection?.selectedServers) {
		(locals as unknown as Record<string, unknown>).mcp = {
			selectedServerNames: selection.selectedServerNames,
			selectedServers: selection.selectedServers ?? [],
		};
	}
	if (selection?.timezone) {
		(locals as unknown as Record<string, unknown>).timezone = selection.timezone;
	}

	const generationId = randomUUID();
	restoreRunningShape(message);
	const initialContent = message.content;
	const promptedAt = new Date();
	const abortController = new AbortController();
	const conversationKey = conversationId.toString();

	await clearStaleStopMarker(conversationId);

	// The browser finds a running turn through the last assistant message's generationId
	// (see parkedSweeper). A reaper-set `interrupted` would make the message unsubscribable.
	message.generationId = generationId;
	delete message.interrupted;
	await collections.conversations.updateOne(
		{ _id: conv._id, "messages.id": message.id },
		{
			$set: { "messages.$.generationId": generationId, updatedAt: new Date() },
			$unset: { "messages.$.interrupted": "" },
		}
	);

	const writer = await createGenerationWriter({
		generationId,
		conversationId: conv._id,
		messageId: message.id,
		continueFromSeq: message.materializedSeq,
		...(conv.userId ? { userId: conv.userId } : {}),
		...(locals.sessionId ? { sessionId: locals.sessionId } : {}),
		snapshot: () => ({
			content: message.content,
			reasoning: message.reasoning,
			files: message.files,
			routerMetadata: message.routerMetadata,
			updates: compressUpdatesForStorage(message.updates),
		}),
	});

	let finalAnswerReceived = false;
	const apply = (event: MessageUpdate) => {
		const applied = applyUpdateToMessage(event, {
			message,
			conv,
			initialContent,
			isRouterModel: Boolean(model.isRouter),
		});
		if (applied.skipped) return;
		if (applied.finalAnswerReceived) finalAnswerReceived = true;
		writer.push(event);
	};

	// This message only, never the whole array: the route saves all messages from the
	// snapshot it loaded, and doing the same here would overwrite a turn another producer
	// wrote meanwhile.
	const persist = async () => {
		message.materializedSeq = writer.currentSeq();
		const stored = messageForStorage(message);
		// written field by field, restoreRunningShape can drop both from a message stored converted
		const unset: Record<string, ""> = {};
		if (stored.reasoning === undefined) unset["messages.$.reasoning"] = "";
		if (stored.contentShape === undefined) unset["messages.$.contentShape"] = "";
		await collections.conversations.updateOne(
			{ _id: conv._id, "messages.id": message.id },
			{
				$set: {
					"messages.$.content": stored.content,
					"messages.$.updates": stored.updates,
					"messages.$.materializedSeq": message.materializedSeq,
					"messages.$.updatedAt": new Date(),
					...(stored.reasoning !== undefined ? { "messages.$.reasoning": stored.reasoning } : {}),
					...(stored.contentShape !== undefined
						? { "messages.$.contentShape": stored.contentShape }
						: {}),
					...(message.files !== undefined ? { "messages.$.files": message.files } : {}),
					...(message.routerMetadata !== undefined
						? { "messages.$.routerMetadata": message.routerMetadata }
						: {}),
					...(message.interrupted !== undefined
						? { "messages.$.interrupted": message.interrupted }
						: {}),
					title: conv.title,
					updatedAt: new Date(),
				},
				...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
			}
		);
	};

	const turnKey = {
		conversationId: conv._id,
		messageId: message.id,
		producerId: generationId,
		...(conv.userId ? { userId: conv.userId } : {}),
		...(locals.sessionId ? { sessionId: locals.sessionId } : {}),
	};

	// Answer first, stored before the model is called and before the claim is consumed: a
	// process that dies past this point leaves an ordinary interrupted turn whose history
	// holds the answer, and one that dies before it leaves a claim the sweep takes over.
	try {
		apply(await turnRunning(turnKey));
		// A claim taken over from a dead process may find the answer already in place.
		if (!alreadySettled(message, elicitationId)) {
			for (const update of await answerUpdates(row)) apply(update);
		}
		await persist();
	} catch (err) {
		logger.error({ err, elicitationId }, "[ask] failed to store the answer; the sweep will retry");
		// Still parked, as far as anyone can tell; the retry is what moves the turn on.
		writer.push(await turnAwaitingInput(turnKey));
		await writer.finish({ status: "error" });
		await releaseElicitationResume(row);
		throw err;
	}
	// The answer is stored, so the run goes ahead even if this write does not land: a claim
	// left `resuming` is closed by the next sweep, which finds the run in the transcript.
	await finishElicitationResume(row).catch((err) =>
		logger.error({ err, elicitationId }, "[ask] failed to consume the claim")
	);

	const run = (async () => {
		AbortRegistry.getInstance().register(conversationKey, abortController);
		const stopWatching = watchStopMarker(conversationId, abortController);
		let failure: string | undefined;
		try {
			try {
				const ctx: TextGenerationContext = {
					model,
					endpoint: await model.getEndpoint(),
					conv,
					messages: buildSubtree(conv, message.id),
					promptedAt,
					ip: "ask-resume",
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
			} catch (err) {
				// A Stop surfaces as a throw from the provider call; that is not a failure.
				if (!abortController.signal.aborted) {
					logger.error({ err, elicitationId }, "[ask] resumed turn failed");
					failure = err instanceof Error ? err.message : "The resumed turn failed.";
					apply({
						type: MessageUpdateType.Status,
						status: MessageUpdateStatus.Error,
						message: failure,
					});
				}
			}
			if (abortController.signal.aborted && !finalAnswerReceived) {
				apply({
					type: MessageUpdateType.FinalAnswer,
					text: message.content.slice(initialContent.length),
					interrupted: true,
				});
			}
			// Closes this run's lifecycle even when it parked again (see parkedSweeper).
			if (failure === undefined) {
				apply({ type: MessageUpdateType.Status, status: MessageUpdateStatus.Finished });
			}
			// CAS: misses when the run parked again, and that state stands.
			const endedUpdate = await turnEnded(
				turnKey,
				failure === undefined ? { failed: false } : { failed: true, error: failure }
			);
			if (endedUpdate) apply(endedUpdate);
		} finally {
			const aborted = abortController.signal.aborted;
			stopWatching();
			AbortRegistry.getInstance().unregister(conversationKey, abortController);
			await persist().catch((err) =>
				logger.error({ err, elicitationId }, "[ask] failed to save the resumed turn")
			);
			await writer.finish({
				status: failure !== undefined ? "error" : aborted ? "interrupted" : "completed",
			});
			if (aborted) {
				await collections.abortedGenerations
					.deleteOne({ conversationId })
					.catch((err) => logger.warn({ err }, "[ask] failed to consume stop marker"));
			}
		}
	})();

	return { outcome: "resumed", run };
}

/** Put the answer on record in a turn that will not run again, and close that turn. */
async function storeAnswerOnly(
	conv: Conversation,
	message: Message,
	row: McpElicitation
): Promise<void> {
	if (!alreadySettled(message, row.elicitationId)) {
		const updates = await answerUpdates(row);
		const ended = await turnAnsweredWithoutRun(conv._id, message.id);
		await collections.conversations.updateOne({ _id: conv._id, "messages.id": message.id }, {
			$push: { "messages.$.updates": { $each: ended ? [...updates, ended] : updates } },
			$set: { "messages.$.updatedAt": new Date(), updatedAt: new Date() },
		} as never);
	}
	await finishElicitationResume(row);
}

/**
 * For the conversation route, before it saves a NEW turn: any question in this conversation
 * that a human answered but whose answer never reached the transcript gets its result now,
 * written into `conv` in memory so the route's own save carries it. Without this the new
 * turn replays that tool call as "interrupted before a result was recorded" and the model
 * asks again. Returns a function to call once that save has landed, which consumes the
 * claims — after the save, as its own write, so a failed save leaves them to be retried.
 */
export async function settleAnsweredAsks(
	conv: Pick<Conversation, "_id" | "messages">
): Promise<() => Promise<void>> {
	const now = Date.now();
	const rows = await collections.mcpElicitations
		.find({
			conversationId: conv._id,
			status: "resolved",
			"pending.kind": "ask",
			$or: [
				{ resume: { $exists: false } },
				{
					"resume.status": "resuming",
					"resume.takenAt": { $lt: new Date(now - RESUME_LEASE_MS) },
				},
			],
		})
		.toArray();

	const claimed: McpElicitation[] = [];
	for (const candidate of rows) {
		// Only what a human answered: a close the system wrote is not an answer to report.
		const byUser = candidate.resolution
			? candidate.resolution === "user"
			: candidate.action !== "cancel";
		if (!byUser) continue;
		const row = await claimElicitationResume(conv._id, candidate.elicitationId);
		if (!row) continue;
		claimed.push(row);
		const message = conv.messages.find((m) => m.id === row.pending?.messageId);
		if (!message || message.from !== "assistant" || alreadySettled(message, row.elicitationId)) {
			continue;
		}
		const ended = await turnAnsweredWithoutRun(conv._id, message.id);
		message.updates = [
			...(message.updates ?? []),
			...(await answerUpdates(row)),
			...(ended ? [ended] : []),
		];
		message.updatedAt = new Date();
	}

	return async () => {
		for (const row of claimed) {
			await finishElicitationResume(row).catch((err) =>
				logger.error({ err, elicitationId: row.elicitationId }, "[ask] failed to consume a claim")
			);
		}
	};
}

/** Answers whose process died before it could continue them. */
export async function sweepAnsweredAsks(): Promise<void> {
	const now = Date.now();
	const rows = await collections.mcpElicitations
		.find(
			{
				status: "resolved",
				"pending.kind": "ask",
				resolution: "user",
				resolvedAt: {
					$gte: new Date(now - SWEEP_MAX_AGE_MS),
					$lte: new Date(now - SWEEP_GRACE_MS),
				},
				$or: [
					{ resume: { $exists: false } },
					{
						"resume.status": "resuming",
						"resume.takenAt": { $lt: new Date(now - RESUME_LEASE_MS) },
					},
				],
			},
			{ projection: { elicitationId: 1, conversationId: 1 } }
		)
		.sort({ resolvedAt: 1 })
		.limit(SWEEP_BATCH)
		.toArray();

	for (const { conversationId, elicitationId } of rows) {
		logger.info({ elicitationId }, "[ask] resuming an answered question nothing continued");
		await kickAnsweredAsk(conversationId, elicitationId);
	}
}

/** Start the continuation and return once the answer is stored; never throws. */
export async function kickAnsweredAsk(
	conversationId: ObjectId,
	elicitationId: string,
	selection?: AskResumeSelection
): Promise<AskResumeOutcome | "failed"> {
	try {
		const { outcome, run } = await resumeAnsweredAsk({
			conversationId,
			elicitationId,
			...(selection ? { selection } : {}),
		});
		run?.catch((err) => logger.error({ err, elicitationId }, "[ask] resumed turn crashed"));
		return outcome;
	} catch (err) {
		logger.error({ err, elicitationId }, "[ask] failed to resume an answered question");
		return "failed";
	}
}

export class AnsweredAskSweeper {
	private static instance: AnsweredAskSweeper;

	private constructor() {
		const interval = setInterval(() => {
			sweepAnsweredAsks().catch((err) => logger.error({ err }, "[ask] sweep failed"));
		}, sweepIntervalMs());
		interval.unref?.();
		onExit(() => clearInterval(interval));
	}

	public static getInstance(): AnsweredAskSweeper {
		if (!AnsweredAskSweeper.instance) {
			AnsweredAskSweeper.instance = new AnsweredAskSweeper();
		}
		return AnsweredAskSweeper.instance;
	}
}
