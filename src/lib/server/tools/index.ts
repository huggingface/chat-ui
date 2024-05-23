import type { Assistant } from "$lib/types/Assistant";
import type { Conversation } from "$lib/types/Conversation";
import type { Message } from "$lib/types/Message";
import type { MessageUpdate } from "$lib/types/MessageUpdate";
import type { Tool, ToolResult } from "$lib/types/Tool";

import calculator from "./calculator";
import directlyAnswer from "./directlyAnswer";
import imageEditing from "./images/editing";
import imageGeneration from "./images/generation";
import documentParser from "./documentParser";
import fetchUrl from "./web/url";
import websearch from "./web/search";

export interface BackendToolContext {
	conv: Conversation;
	messages: Message[];
	preprompt?: string;
	assistant?: Pick<Assistant, "rag" | "dynamicPrompt" | "generateSettings">;
}

export interface BackendTool extends Tool {
	call(
		params: Record<string, string | number | boolean>,
		context: BackendToolContext
	): AsyncGenerator<MessageUpdate, Omit<ToolResult, "call">, undefined>;
}

export const allTools: BackendTool[] = [
	directlyAnswer,
	websearch,
	imageGeneration,
	fetchUrl,
	imageEditing,
	documentParser,
	calculator,
];
