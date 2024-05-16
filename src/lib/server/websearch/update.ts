import type { WebSearch, WebSearchSource } from "$lib/types/WebSearch";
import {
	TextGenerationUpdateType,
	TextGenerationWebSearchUpdateType,
	type TextGenerationWebSearchErrorUpdate,
	type TextGenerationWebSearchFinalAnswerUpdate,
	type TextGenerationWebSearchGeneralUpdate,
	type TextGenerationWebSearchSourcesUpdate,
} from "../textGeneration/types";

export function makeGeneralUpdate(
	update: Pick<TextGenerationWebSearchGeneralUpdate, "message" | "args">
): TextGenerationWebSearchGeneralUpdate {
	return {
		type: TextGenerationUpdateType.WebSearch,
		subtype: TextGenerationWebSearchUpdateType.Update,
		...update,
	};
}

export function makeErrorUpdate(
	update: Pick<TextGenerationWebSearchErrorUpdate, "message" | "args">
): TextGenerationWebSearchErrorUpdate {
	return {
		type: TextGenerationUpdateType.WebSearch,
		subtype: TextGenerationWebSearchUpdateType.Error,
		...update,
	};
}

export function makeSourcesUpdate(
	sources: WebSearchSource[]
): TextGenerationWebSearchSourcesUpdate {
	return {
		type: TextGenerationUpdateType.WebSearch,
		subtype: TextGenerationWebSearchUpdateType.Sources,
		message: "sources",
		sources,
	};
}

export function makeFinalAnswerUpdate(
	webSearch: WebSearch
): TextGenerationWebSearchFinalAnswerUpdate {
	return {
		type: TextGenerationUpdateType.WebSearch,
		subtype: TextGenerationWebSearchUpdateType.FinalAnswer,
		webSearch,
	};
}
