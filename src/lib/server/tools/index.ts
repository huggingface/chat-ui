import type { Assistant } from "$lib/types/Assistant";
import type { Conversation } from "$lib/types/Conversation";
import type { Message } from "$lib/types/Message";
import type { Tool, ToolResult } from "$lib/types/Tool";
import type { TextGenerationUpdate } from "../textGeneration/types";
import calculator from "./calculator";
import codeInterpreter from "./codeInterpreter";
import fetchUrl from "./web/url";
import text2image from "./multimodal/text2image";
import websearch from "./web/search";

interface BackendToolContext {
	conv: Conversation;
	messages: Message[];
	preprompt?: string;
	assistant?: Pick<Assistant, "rag" | "dynamicPrompt" | "generateSettings">;
}

export interface BackendTool extends Tool {
	call(
		params: Record<string, string>,
		context: BackendToolContext
	): AsyncGenerator<TextGenerationUpdate, Omit<ToolResult, "call">, undefined>;
}

export const allTools: BackendTool[] = [
	calculator,
	codeInterpreter,
	fetchUrl,
	text2image,
	websearch,
];
