import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

// a message of its own after the tool results would sit inside the assistant turn, where the
// window, the plan and state blocks and strict alternation all expect none
export function withHarnessEvent(output: string, text: string): string {
	return `${output}\n\n${text}`;
}

/** the live form, the tool results of the round are the last tool messages in the list */
export function withHarnessEventOnLastTool(
	messages: ChatCompletionMessageParam[],
	text: string
): ChatCompletionMessageParam[] {
	const index = messages.findLastIndex((m) => m.role === "tool");
	const last = messages[index];
	if (last?.role !== "tool") return messages;
	const content =
		typeof last.content === "string"
			? withHarnessEvent(last.content, text)
			: [...last.content, { type: "text" as const, text: withHarnessEvent("", text) }];
	return messages.map((m, i) => (i === index ? { ...last, content } : m));
}
