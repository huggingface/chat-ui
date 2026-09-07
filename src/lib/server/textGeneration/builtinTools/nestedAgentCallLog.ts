import { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import { logger } from "$lib/server/logger";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { NestedAgentCall } from "$lib/types/NestedAgentCall";

const ARGUMENTS_MAX = 600;
const ERROR_MAX = 600;

/**
 * Sandbox commands carry live credentials. Ordered longest-context-first, so
 * `Bearer <token>` and `KEY=<value>` are consumed whole rather than leaving a
 * naked assignment behind.
 */
const SECRET_PATTERNS: RegExp[] = [
	/\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi,
	/\b(?:[A-Z_]*(?:TOKEN|SECRET|PASSWORD|API_?KEY))\s*[:=]\s*("|')?[^\s"',}]{6,}\1?/gi,
	/("|')?(?:token|secret|password|api[_-]?key)("|')?\s*[:=]\s*("|')?[^\s"',}]{6,}/gi,
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
	refusals: ChatCompletionMessageParam[] = []
): void {
	let rows: NestedAgentCall[];
	try {
		rows = buildRows(ctx, label, iteration, calls, toolMessages, refusals);
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
	refusals: ChatCompletionMessageParam[]
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

	for (const refusal of refusals) {
		const content = typeof refusal.content === "string" ? refusal.content : "";
		rows.push({
			_id: new ObjectId(),
			...base,
			toolName: /Tool '([^']+)'/.exec(content)?.[1] ?? "unknown",
			arguments: "",
			repeatCount: 1,
			status: "error",
			error: clamp(content, ERROR_MAX),
		});
	}

	return rows;
}
