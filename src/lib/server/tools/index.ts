import type { Assistant } from "$lib/types/Assistant";
import type { Conversation } from "$lib/types/Conversation";
import type { Message } from "$lib/types/Message";
import type { Tool, ToolResult } from "$lib/types/Tool";
import type { TextGenerationUpdate } from "../textGeneration/types";
import calculator from "./calculator";
import directlyAnswer from "./directlyAnswer";
import fetchUrl from "./fetchUrl";
import text2img from "./text2img";
import websearch from "./websearch";

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

export const allTools: BackendTool[] = [calculator, websearch, text2img, directlyAnswer, fetchUrl];
