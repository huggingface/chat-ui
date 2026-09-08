import { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import { logger } from "$lib/server/logger";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { NestedAgentCall } from "$lib/types/NestedAgentCall";

const ARGUMENTS_MAX = 600;
const ERROR_MAX = 600;

/**
 * Sandbox commands carry live credentials. Ordered so the longest context wins:
 * a quoted value is consumed whole before the bare-token pattern can nibble at
 * its first word, and a flag takes its argument with it.
 *
 * Not a proof of absence — a denylist over free-form shell never is — which is
 * also why arguments are truncated and outputs are never stored at all.
 */
const QUOTED_OR_BARE = `(?:"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|[^\\s,;}]+)`;
const SECRET_WORD = `(?:token|secret|password|passwd|api[_-]?key|credential)s?`;

const SECRET_PATTERNS: RegExp[] = [
	// KEY="value with spaces", KEY='...', KEY=bare
	new RegExp(`\\b[A-Za-z_][A-Za-z0-9_]*${SECRET_WORD}\\s*[:=]\\s*${QUOTED_OR_BARE}`, "gi"),
	// --password hunter2, --api-key=abc, -p secret
	new RegExp(`(^|\\s)--?[A-Za-z0-9-]*${SECRET_WORD}[=\\s]+${QUOTED_OR_BARE}`, "gi"),
	// "password": "…" and password: … in JSON or prose
	new RegExp(`("|')?${SECRET_WORD}\\1?\\s*[:=]\\s*${QUOTED_OR_BARE}`, "gi"),
	/\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi,
	/\b(?:hf_|github_pat_|ghp_|gho_|sk-)[A-Za-z0-9_-]{8,}/g,
];
export function redactSecrets(text: string): string {
	return SECRET_PATTERNS.reduce((acc, re) => acc.replace(re, "<redacted>"), text);
}

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
		label,
		iteration,
		createdAt: new Date(),
	};

	const byId = new Map<string, string>();
	for (const message of toolMessages) {
		if (message.role !== "tool") continue;
		const id = (message as { tool_call_id?: string }).tool_call_id;
		if (typeof id === "string" && typeof message.content === "string") {
			byId.set(id, message.content);
		}
	}

	const rows: NestedAgentCall[] = calls.map((call) => {
		const content = byId.get(call.id);
		const row = {
			_id: new ObjectId(),
			...base,
			toolName: call.name,
			arguments: clamp(call.arguments, ARGUMENTS_MAX),
			repeatCount: call.repeatCount,
		};
		// Cut short rather than run — the iteration was spent either way.
		if (content === undefined) {
			return { ...row, status: "error" as const, error: "no result observed for this call" };
		}
		if (content.startsWith(ERROR_PREFIX)) {
			return {
				...row,
				status: "error" as const,
				error: clamp(content.slice(ERROR_PREFIX.length), ERROR_MAX),
			};
		}
		return { ...row, status: "success" as const };
	});

	for (const call of refused) {
		rows.push({
			_id: new ObjectId(),
			...base,
			toolName: call.name || "unknown",
			arguments: clamp(call.arguments, ARGUMENTS_MAX),
			repeatCount: call.repeatCount,
			status: "error",
			error: `Tool '${call.name}' not available for ${label}.`,
		});
	}

	return rows;
}
