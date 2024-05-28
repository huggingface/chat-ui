import type { MessageUpdate } from "$lib/types/MessageUpdate";
import type { Tool, ToolResultSuccess } from "$lib/types/Tool";

import calculator from "./calculator";
import directlyAnswer from "./directlyAnswer";
import imageEditing from "./images/editing";
import imageGeneration from "./images/generation";
import documentParser from "./documentParser";
import fetchUrl from "./web/url";
import websearch from "./web/search";
import type { TextGenerationContext } from "../textGeneration/types";

export type BackendToolContext = Pick<
	TextGenerationContext,
	"conv" | "messages" | "assistant" | "ip" | "username"
> & { preprompt?: string };

export interface BackendTool extends Tool {
	call(
		params: Record<string, string | number | boolean>,
		context: BackendToolContext
	): AsyncGenerator<MessageUpdate, Omit<ToolResultSuccess, "status" | "call" | "type">, undefined>;
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
