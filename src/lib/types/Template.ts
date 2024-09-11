import type { Message } from "./Message";
import type { Tool, ToolResult } from "./Tool";

export type ChatTemplateInput = {
	messages: Pick<Message, "from" | "content" | "files">[];
	preprompt?: string;
	tools?: Tool[];
	toolResults?: ToolResult[];
	continueMessage?: boolean;
};
