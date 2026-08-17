import { randomUUID } from "crypto";
import { ObjectId } from "mongodb";
import type { Client } from "@modelcontextprotocol/sdk/client";
import { collections } from "$lib/server/database";
import { logger } from "$lib/server/logger";
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
import type { McpCallDeadline } from "./httpClient";

const POLL_INTERVAL_MS = 400;

/** Where a prompt is shown and an answer is waited for: one live generation. */
export interface ElicitationSink {
	/** Stable per generation, so two calls from the same run are recognised as one audience. */
	id: string;
	conversationId: ObjectId;
	generationId?: string;
	emit: (update: MessageUpdate) => void;
}

interface CallContext {
	sink: ElicitationSink;
	server: string;
	toolUuid: string;
	/** Stopped for as long as the user is being asked something, then restarted. */
	deadline: Pick<McpCallDeadline, "pause" | "resume">;
	signal?: AbortSignal;
}

/**
 * Tool calls currently running on each pooled client.
 *
 * MCP gives a server-initiated request no link back to the client request that provoked
 * it, and `clientPool` shares one client across every chat using the same server and
 * headers. So the only way to know whose screen an `elicitation/create` belongs on is to
 * look at what that client is doing right now — hence this registry, and hence the
 * refusal in `routeTo` when the answer is not unique.
 */
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
	const audiences = new Set(contexts.map((c) => c.sink.id));
	if (audiences.size > 1) {
		// Two different chats are using this pooled connection at once. Guessing would
		// mean showing one user's prompt — and collecting their answer — in someone
		// else's conversation, so refuse instead.
		return { refusal: "concurrent tool calls from different generations" };
	}
	// One audience, so every call here belongs to the round the user is answering for and
	// all of their clocks stop together — we cannot tell which one actually asked.
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

/**
 * Give up on a prompt nobody answered, and record that we did.
 *
 * Conditional on the row still being pending so it can race the answer endpoint without
 * overwriting a real answer that landed a moment earlier.
 */
async function abandon(
	elicitationId: string,
	resolution: Exclude<ElicitationResolution, "user">
): Promise<ElicitationOutcome> {
	const claimed = await collections.mcpElicitations
		.updateOne(
			{ elicitationId, status: "pending" },
			{
				$set: {
					status: "resolved",
					action: "cancel",
					resolvedAt: new Date(),
					updatedAt: new Date(),
				},
			}
		)
		.catch(() => null);

	// Nothing left to claim: an answer landed between the last poll and this write, and
	// discarding it now would lose input the user has already given.
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

/**
 * Show a prompt and wait for the user, across pods.
 *
 * The answer arrives on whichever pod serves the user's POST, which need not be this one,
 * so the row in Mongo is the channel and polling is the delivery — the same shape
 * `abortedGenerations` uses for stop.
 */
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
		// Checked in this order so the reason shown is the one that actually happened first:
		// the user stopping the response, versus the server giving up on its own request.
		if (generation?.aborted) return abandon(elicitationId, "aborted");
		if (server?.aborted) return abandon(elicitationId, "withdrawn");
		if (Date.now() >= deadlineAt) return abandon(elicitationId, "expired");

		// `undefined` for a failed read, so a transient database blip is retried rather
		// than mistaken for a row that is gone.
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
		// The row really is gone — dropped by the TTL sweep — so there is nothing to wait for.
		if (doc === null) return { action: "cancel", resolution: "expired" };

		await sleep(Math.min(POLL_INTERVAL_MS, Math.max(0, deadlineAt - Date.now())), signal);
	}
}

/**
 * Answer an `elicitation/create`: show it to the user who triggered the tool call, wait,
 * and hand the result back to the server.
 *
 * Never throws. Every failure — unroutable, unrenderable, unanswered — becomes a `cancel`,
 * which the spec requires servers to handle, so a bad prompt degrades to a tool call that
 * proceeds without the extra input instead of a broken conversation.
 */
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

	// Independent of the tool call's deadline, which is stopped for the duration below.
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

	// Stop the tool call's clock for as long as a person is being asked something, so a
	// slow answer never expires the call that is waiting on it.
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
	});

	logger.debug(
		{ server: context.server, action: outcome.action, resolution: outcome.resolution },
		"[mcp] elicitation resolved"
	);

	// Content is meaningful only on accept; the spec has servers ignore it otherwise.
	return outcome.action === "accept"
		? { action: "accept", content: outcome.content ?? {} }
		: { action: outcome.action };
}

export type SubmitResult = { ok: true } | { ok: false; status: 400 | 404 | 409; error: string };

/**
 * Record the user's answer. Called by the response endpoint on whichever pod served it,
 * which is usually not the pod waiting on the tool call.
 */
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
	// Scoped by conversation, so holding an id is not enough to answer a prompt raised in
	// a conversation the caller does not own.
	const doc = await collections.mcpElicitations.findOne({ elicitationId, conversationId });
	if (!doc) return { ok: false, status: 404, error: "Unknown elicitation." };
	if (doc.status !== "pending") return { ok: false, status: 409, error: "Already answered." };
	if (doc.expiresAt.getTime() <= Date.now()) {
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

	// `status: "pending"` in the filter makes a double submit a no-op rather than a
	// second, different answer to a server that already got the first.
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

	return { ok: true };
}
