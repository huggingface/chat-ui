import type { Message } from "./Message";
import type { Tool, ToolResult } from "./Tool";

export type ChatTemplateInput = {
	messages: Pick<Message, "from" | "content">[];
	preprompt?: string;
	tools?: Tool[];
	toolResults?: ToolResult[];
};
