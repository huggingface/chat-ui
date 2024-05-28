import type { MessageUpdate } from "$lib/types/MessageUpdate";
import type { Tool, ToolResultError, ToolResultSuccess } from "$lib/types/Tool";

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

// typescript can't narrow a discriminated union after applying a generic like Omit to it
// so we have to define the omitted types and create a new union
type ToolResultSuccessOmitted = Omit<ToolResultSuccess, "call">;
type ToolResultErrorOmitted = Omit<ToolResultError, "call">;
type ToolResultOmitted = ToolResultSuccessOmitted | ToolResultErrorOmitted;

export interface BackendTool extends Tool {
	call(
		params: Record<string, string | number | boolean>,
		context: BackendToolContext
	): AsyncGenerator<MessageUpdate, ToolResultOmitted, undefined>;
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
