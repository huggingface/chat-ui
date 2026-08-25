import { randomUUID } from "crypto";
import { ObjectId } from "mongodb";
import type { Client } from "@modelcontextprotocol/client";
import { collections } from "$lib/server/database";
import { logger } from "$lib/server/logger";
import type { McpElicitation, PendingMcpCall } from "$lib/types/McpElicitation";
import type {
	ElicitationAction,
	ElicitationRequestPayload,
	ElicitationResolution,
	ElicitationValue,
} from "$lib/types/McpElicitation";
import {
	MessageElicitationUpdateType,
	MessageUpdateType,
	type MessageUpdate,
} from "$lib/types/MessageUpdate";
import { normalizeElicitationRequest, validateElicitationContent } from "./elicitationSchema";
import { getElicitationTimeoutMs } from "./elicitationConfig";
import type { McpCallDeadline, McpInputRequired } from "./httpClient";
import type { InputResponses } from "@modelcontextprotocol/client";

const POLL_INTERVAL_MS = 400;

export interface ElicitationSink {
	conversationId: ObjectId;
	generationId?: string;
	emit: (update: MessageUpdate) => void;
}

interface CallContext {
	sink: ElicitationSink;
	server: string;
	toolUuid: string;
	deadline: Pick<McpCallDeadline, "pause" | "resume">;
	signal?: AbortSignal;
}

/** MCP does not link an `elicitation/create` to the call that provoked it; this is the only clue. */
const inFlight = new WeakMap<Client, Set<CallContext>>();

export async function withElicitationContext<T>(
	client: Client,
	context: CallContext,
	run: () => Promise<T>
): Promise<T> {
	let contexts = inFlight.get(client);
	if (!contexts) {
		contexts = new Set();
		inFlight.set(client, contexts);
	}
	contexts.add(context);
	try {
		return await run();
	} finally {
		contexts.delete(context);
	}
}

type Route = { context: CallContext; siblings: CallContext[]; attributable: boolean };

function routeTo(client: Client): Route | { refusal: string } {
	const contexts = [...(inFlight.get(client) ?? [])];
	if (contexts.length === 0) {
		return { refusal: "no tool call is in flight on this connection" };
	}
	// Compared by identity, not by generationId: that is client-supplied, so two callers
	// could claim the same one and collapse this check.
	const audiences = new Set(contexts.map((c) => c.sink));
	if (audiences.size > 1) {
		// Never guess: that puts one user's prompt, and their answer, in another's conversation.
		return { refusal: "concurrent tool calls from different generations" };
	}
	return { context: contexts[0], siblings: contexts, attributable: contexts.length === 1 };
}

export type ElicitationOutcome = {
	action: ElicitationAction;
	content?: Record<string, ElicitationValue>;
	resolution: ElicitationResolution;
};

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
	new Promise((resolve) => {
		const onAbort = () => {
			clearTimeout(timer);
			resolve();
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	});

/** Filtered on `pending` so racing the answer endpoint cannot overwrite a real answer. */
async function abandon(
	elicitationId: string,
	resolution: Exclude<ElicitationResolution, "user">
): Promise<ElicitationOutcome> {
	const close = () =>
		collections.mcpElicitations.updateOne(
			{ elicitationId, status: "pending" },
			{
				$set: {
					status: "resolved",
					action: "cancel",
					resolvedAt: new Date(),
					updatedAt: new Date(),
				},
			}
		);

	// Retried once: a row left pending is one a reloaded form can still submit into nothing.
	const claimed = await close()
		.catch(() => close())
		.catch((err) => {
			logger.error({ err, elicitationId }, "[mcp] failed to close elicitation");
			return null;
		});

	// Nothing to claim means an answer landed since the last poll; discarding it loses input.
	if (claimed?.matchedCount === 0) {
		const current = await collections.mcpElicitations.findOne({ elicitationId }).catch(() => null);
		if (current?.status === "resolved" && current.action) {
			return {
				action: current.action,
				...(current.content ? { content: current.content } : {}),
				resolution: "user",
			};
		}
	}
	return { action: "cancel", resolution };
}

/** Polled, not pushed: the answer lands on whichever pod served the user's POST. */
async function awaitAnswer(
	elicitationId: string,
	{
		deadlineAt,
		generation,
		server,
	}: { deadlineAt: number; generation?: AbortSignal; server?: AbortSignal }
): Promise<ElicitationOutcome> {
	const signal =
		generation && server ? AbortSignal.any([generation, server]) : (generation ?? server);

	for (;;) {
		// Order matters: stopping the response is what makes the server hang up.
		if (generation?.aborted) return abandon(elicitationId, "aborted");
		if (server?.aborted) return abandon(elicitationId, "withdrawn");
		if (Date.now() >= deadlineAt) return abandon(elicitationId, "expired");

		// `undefined` on failure, so a database blip is retried rather than read as a gone row.
		const doc = await collections.mcpElicitations
			.findOne({ elicitationId }, { projection: { status: 1, action: 1, content: 1 } })
			.catch(() => undefined);

		if (doc?.status === "resolved") {
			return {
				action: doc.action ?? "cancel",
				...(doc.content ? { content: doc.content } : {}),
				resolution: "user",
			};
		}
		if (doc === null) return { action: "cancel", resolution: "expired" };

		await sleep(Math.min(POLL_INTERVAL_MS, Math.max(0, deadlineAt - Date.now())), signal);
	}
}

/** Never throws: every failure becomes a `cancel`, which servers must already handle. */
export async function handleElicitationRequest(
	client: Client,
	params: unknown,
	/** Fires when the server withdraws the request, i.e. its own timeout beat ours. */
	serverSignal?: AbortSignal
): Promise<{ action: ElicitationAction; content?: Record<string, ElicitationValue> }> {
	const route = routeTo(client);
	if ("refusal" in route) {
		logger.warn({ reason: route.refusal }, "[mcp] declining elicitation it cannot attribute");
		return { action: "cancel" };
	}
	const { context, siblings, attributable } = route;

	const normalized = normalizeElicitationRequest(params);
	if (!normalized.ok) {
		logger.warn(
			{ server: context.server, reason: normalized.reason },
			"[mcp] declining unsupported elicitation"
		);
		return { action: "cancel" };
	}

	const elicitationId = randomUUID();
	const request: ElicitationRequestPayload = {
		...normalized.payload,
		elicitationId,
		server: context.server,
	};

	const expiresAt = new Date(Date.now() + getElicitationTimeoutMs());

	const now = new Date();
	try {
		await collections.mcpElicitations.insertOne({
			_id: new ObjectId(),
			elicitationId,
			conversationId: context.sink.conversationId,
			...(context.sink.generationId ? { generationId: context.sink.generationId } : {}),
			status: "pending",
			request,
			expiresAt,
			createdAt: now,
			updatedAt: now,
		});
	} catch (err) {
		logger.error({ err, server: context.server }, "[mcp] failed to record elicitation");
		return { action: "cancel" };
	}

	context.sink.emit({
		type: MessageUpdateType.Elicitation,
		subtype: MessageElicitationUpdateType.Request,
		request,
		expiresAt: expiresAt.getTime(),
		...(attributable ? { toolUuid: context.toolUuid } : {}),
	});

	// Without this the call expires underneath a user who takes their time answering it.
	for (const sibling of siblings) sibling.deadline.pause();
	let outcome: ElicitationOutcome;
	try {
		outcome = await awaitAnswer(elicitationId, {
			deadlineAt: expiresAt.getTime(),
			generation: context.signal,
			server: serverSignal,
		});
	} finally {
		for (const sibling of siblings) sibling.deadline.resume();
	}

	context.sink.emit({
		type: MessageUpdateType.Elicitation,
		subtype: MessageElicitationUpdateType.Resolved,
		elicitationId,
		action: outcome.action,
		resolution: outcome.resolution,
		...(outcome.content ? { content: outcome.content } : {}),
	});

	logger.debug(
		{ server: context.server, action: outcome.action, resolution: outcome.resolution },
		"[mcp] elicitation resolved"
	);

	return outcome.action === "accept"
		? { action: "accept", content: outcome.content ?? {} }
		: { action: outcome.action };
}

export type SubmitResult =
	| { ok: true; resume: boolean; messageId?: string }
	| { ok: false; status: 400 | 404 | 409; error: string };

export async function submitElicitationAnswer({
	elicitationId,
	conversationId,
	action,
	content,
}: {
	elicitationId: string;
	conversationId: ObjectId;
	action: ElicitationAction;
	content?: unknown;
}): Promise<SubmitResult> {
	// Scoped by conversation: holding an id is not authority to answer someone else's prompt.
	const doc = await collections.mcpElicitations.findOne({ elicitationId, conversationId });
	if (!doc) return { ok: false, status: 404, error: "Unknown elicitation." };
	if (doc.status !== "pending") return { ok: false, status: 409, error: "Already answered." };
	if (doc.expiresAt && doc.expiresAt.getTime() <= Date.now()) {
		return { ok: false, status: 409, error: "This request has expired." };
	}

	let validated: Record<string, ElicitationValue> | undefined;
	if (action === "accept") {
		if (doc.request.mode === "form") {
			const result = validateElicitationContent(doc.request.fields ?? [], content ?? {});
			if (!result.ok) return { ok: false, status: 400, error: result.error };
			validated = result.content;
		}
	}

	// `status: "pending"` makes a double submit a no-op rather than a second, different answer.
	const updated = await collections.mcpElicitations.updateOne(
		{ elicitationId, conversationId, status: "pending" },
		{
			$set: {
				status: "resolved",
				action,
				resolvedAt: new Date(),
				updatedAt: new Date(),
				...(validated ? { content: validated } : {}),
			},
		}
	);
	if (updated.matchedCount === 0) return { ok: false, status: 409, error: "Already answered." };

	return {
		ok: true,
		resume: doc.pending !== undefined,
		...(doc.pending ? { messageId: doc.pending.messageId } : {}),
	};
}

/**
 * Record a 2026-era prompt and show it. Returns without waiting: the server kept no state,
 * so the answer can arrive from any process at any time and resume the call then.
 */
export async function openDurableElicitation({
	sink,
	server,
	toolUuid,
	pending,
	inputRequired,
}: {
	sink: ElicitationSink;
	server: string;
	toolUuid: string;
	pending: Omit<PendingMcpCall, "kind" | "inputKey" | "requestState" | "server">;
	inputRequired: McpInputRequired;
}): Promise<{ opened: boolean; reason?: string }> {
	const entries = Object.entries(inputRequired.inputRequests);
	// One question per round keeps resume unambiguous; the spec permits more, but no
	// server we have met asks for more, and answering half a round is not resumable.
	if (entries.length !== 1) {
		return { opened: false, reason: `expected one input request, got ${entries.length}` };
	}
	const [inputKey, request] = entries[0];
	if (request.method !== "elicitation/create") {
		return { opened: false, reason: `unsupported input request: ${request.method}` };
	}

	const normalized = normalizeElicitationRequest(request.params);
	if (!normalized.ok) return { opened: false, reason: normalized.reason };

	const elicitationId = randomUUID();
	const payload: ElicitationRequestPayload = { ...normalized.payload, elicitationId, server };
	const now = new Date();

	try {
		await collections.mcpElicitations.insertOne({
			_id: new ObjectId(),
			elicitationId,
			conversationId: sink.conversationId,
			...(sink.generationId ? { generationId: sink.generationId } : {}),
			status: "pending",
			request: payload,
			pending: {
				...pending,
				server,
				inputKey,
				...(inputRequired.requestState !== undefined
					? { requestState: inputRequired.requestState }
					: {}),
			},
			createdAt: now,
			updatedAt: now,
		});
	} catch (err) {
		logger.error({ err, server }, "[mcp] failed to record durable elicitation");
		return { opened: false, reason: "could not be recorded" };
	}

	sink.emit({
		type: MessageUpdateType.Elicitation,
		subtype: MessageElicitationUpdateType.Request,
		request: payload,
		toolUuid,
	});
	return { opened: true };
}

/** The answered prompt for a conversation, ready to re-issue its tool call. */
export async function takeResumableElicitation(
	conversationId: ObjectId,
	elicitationId: string
): Promise<{ row: McpElicitation; inputResponses: InputResponses } | null> {
	const row = await collections.mcpElicitations.findOne({ elicitationId, conversationId });
	if (!row?.pending || row.status !== "resolved" || !row.action) return null;
	// The model's own question is answered by the answer itself; there is no call to replay
	// responses into.
	if (row.pending.kind === "ask") return { row, inputResponses: {} };
	return {
		row,
		inputResponses: {
			[row.pending.inputKey]: {
				action: row.action,
				...(row.content ? { content: row.content } : {}),
			},
		},
	};
}

/** Recorded when the prompt opened, so it survives whatever the user does meanwhile. */
export async function parkedMessageId(
	conversationId: ObjectId,
	elicitationId: string
): Promise<string | undefined> {
	const row = await collections.mcpElicitations.findOne(
		{ elicitationId, conversationId },
		{ projection: { pending: 1 } }
	);
	return row?.pending?.messageId;
}
