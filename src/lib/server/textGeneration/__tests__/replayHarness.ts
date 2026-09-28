/**
 * Shared vocabulary for the end-to-end replay specs.
 *
 * The `vi.mock` calls themselves have to live in the spec file (they are hoisted
 * per module), so this holds only the parts that don't need hoisting: the
 * scripted-upstream types, the SSE chunk shapes, and the assertion helpers that
 * read a captured request back out.
 */
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

/** One tool call the scripted upstream asks the app to perform. */
export interface ScriptedCall {
	id?: string;
	name: string;
	/** JSON-encoded arguments, exactly as a real provider streams them. */
	arguments: string;
}

/** One scripted upstream completion. */
export interface Round {
	/** Visible content tokens, streamed in order. */
	content?: string | string[];
	/** Reasoning tokens, streamed before content. */
	reasoning?: string | string[];
	/** Which delta field carries reasoning. Providers differ; all three are handled. */
	reasoningField?: "reasoning" | "reasoning_content" | "reasoning_text";
	toolCalls?: ScriptedCall[];
	/** Defaults to "tool_calls" when the round emits calls, else "stop". */
	finishReason?: string;
	/** Throw instead of returning a stream, to script an upstream failure. */
	error?: Error;
}

const asTokens = (v: string | string[] | undefined): string[] =>
	v === undefined ? [] : Array.isArray(v) ? v : [v];

function chunk(choice: Record<string, unknown>) {
	return { choices: [choice] };
}

/** Turn a scripted round into the SSE chunk sequence a provider would stream. */
export function streamFor(round: Round) {
	return (async function* () {
		const field = round.reasoningField ?? "reasoning";
		for (const token of asTokens(round.reasoning)) {
			yield chunk({ delta: { [field]: token } });
		}
		for (const token of asTokens(round.content)) {
			yield chunk({ delta: { content: token } });
		}
		for (const [index, call] of (round.toolCalls ?? []).entries()) {
			yield chunk({
				delta: {
					tool_calls: [
						{ index, id: call.id, function: { name: call.name, arguments: call.arguments } },
					],
				},
			});
		}
		yield chunk({
			delta: {},
			finish_reason: round.finishReason ?? (round.toolCalls?.length ? "tool_calls" : "stop"),
		});
	})();
}

export type ChatMessage = ChatCompletionMessageParam & {
	reasoning_content?: string;
	tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
	tool_call_id?: string;
};

/** `{role}` for each message, so a shape assertion reads as one line. */
export function roles(messages: ChatMessage[]): string[] {
	return messages.map((m) => m.role);
}

/**
 * Compact rendering of an outgoing payload: role, whether the message carries
 * tool_calls / reasoning_content, and a content preview. What a failing shape
 * assertion needs to be readable without dumping the whole array.
 */
export function describeMessages(messages: ChatMessage[]): string {
	return messages
		.map((m, i) => {
			const bits = [`${i} ${m.role}`];
			if (m.tool_calls) bits.push(`tool_calls=[${m.tool_calls.map((c) => c.function.name)}]`);
			if (m.tool_call_id) bits.push(`for=${m.tool_call_id}`);
			if (m.reasoning_content !== undefined)
				bits.push(`reasoning_content=${JSON.stringify(m.reasoning_content)}`);
			if (m.content !== undefined)
				bits.push(`content=${JSON.stringify(String(m.content).slice(0, 80))}`);
			else bits.push("content=<omitted>");
			return bits.join(" ");
		})
		.join("\n");
}
