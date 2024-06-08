import type { Message } from "./Message";
import type { ToolFunction, ToolResult } from "./Tool";

export type ChatTemplateInput = {
	messages: Pick<Message, "from" | "content">[];
	preprompt?: string;
	tools?: ToolFunction[];
	toolResults?: ToolResult[];
};
