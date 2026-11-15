import { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import { logger } from "$lib/server/logger";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { NestedAgentCall } from "$lib/types/NestedAgentCall";
import { redactSecrets } from "$lib/utils/redactSecrets";

const ARGUMENTS_MAX = 600;
const ERROR_MAX = 600;

function clamp(text: string, max: number): string {
	const clean = redactSecrets(text);
	return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

export interface LoggedCall {
	id: string;
	name: string;
	arguments: string;
	repeatCount: number;
}

interface RecordContext {
	conversationId?: ObjectId;
	messageId?: string;
	generationId?: string;
	agentRunId?: string;
}

/**
 * Built from the loop's own inputs, not the emitted Call/Result updates, whose
 * `ToolCall.parameters` drops non-primitives. Fire-and-forget: a logging
 * failure must never change how the sub-agent runs.
 */
export function recordNestedAgentCalls(
	ctx: RecordContext,
	label: string,
	iteration: number,
	calls: LoggedCall[],
	toolMessages: ChatCompletionMessageParam[],
	/** Calls the allowlist rejected; they never reach the executor. */
	refused: LoggedCall[] = []
): void {
	let rows: NestedAgentCall[];
	try {
		rows = buildRows(ctx, label, iteration, calls, toolMessages, refused);
	} catch (err) {
		logger.warn({ err, label }, "[nested-agent-log] could not build rows");
		return;
	}
	if (rows.length === 0) return;

	collections.nestedAgentCalls
		.insertMany(rows, { ordered: false })
		.catch((err) => logger.warn({ err, label }, "[nested-agent-log] insert failed"));
}

/** How executeToolCalls reports a failed call. */
const ERROR_PREFIX = "Error: ";

export interface CallOutcome {
	call: LoggedCall;
	status: "success" | "error";
	/** unredacted and whole, each record cuts it to its own size */
	error?: string;
}

/** the executed calls read against their tool messages, then the refused ones */
export function callOutcomes(
	label: string,
	calls: LoggedCall[],
	toolMessages: ChatCompletionMessageParam[],
	refused: LoggedCall[] = []
): CallOutcome[] {
	const byId = new Map<string, string>();
	for (const message of toolMessages) {
		if (message.role !== "tool") continue;
		const id = (message as { tool_call_id?: string }).tool_call_id;
		if (typeof id === "string" && typeof message.content === "string") {
			byId.set(id, message.content);
		}
	}

	const outcomes: CallOutcome[] = calls.map((call) => {
		const content = byId.get(call.id);
		// Cut short rather than run — the iteration was spent either way.
		if (content === undefined) {
			return { call, status: "error", error: "no result observed for this call" };
		}
		if (content.startsWith(ERROR_PREFIX)) {
			return { call, status: "error", error: content.slice(ERROR_PREFIX.length) };
		}
		return { call, status: "success" };
	});
	for (const call of refused) {
		outcomes.push({
			call: { ...call, name: call.name || "unknown" },
			status: "error",
			error: `Tool '${call.name}' not available for ${label}.`,
		});
	}
	return outcomes;
}

function buildRows(
	ctx: RecordContext,
	label: string,
	iteration: number,
	calls: LoggedCall[],
	toolMessages: ChatCompletionMessageParam[],
	refused: LoggedCall[]
): NestedAgentCall[] {
	const base = {
		...(ctx.conversationId ? { conversationId: ctx.conversationId } : {}),
		...(ctx.messageId ? { messageId: ctx.messageId } : {}),
		...(ctx.generationId ? { generationId: ctx.generationId } : {}),
		...(ctx.agentRunId ? { agentRunId: ctx.agentRunId } : {}),
		label,
		iteration,
		createdAt: new Date(),
	};

	return callOutcomes(label, calls, toolMessages, refused).map(({ call, status, error }) => ({
		_id: new ObjectId(),
		...base,
		toolName: call.name,
		arguments: clamp(call.arguments, ARGUMENTS_MAX),
		repeatCount: call.repeatCount,
		status,
		...(error !== undefined ? { error: clamp(error, ERROR_MAX) } : {}),
	}));
}
