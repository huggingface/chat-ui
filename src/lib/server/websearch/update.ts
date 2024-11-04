import type { WebSearchSource } from "$lib/types/WebSearch";
import {
	MessageUpdateType,
	MessageWebSearchUpdateType,
	type MessageWebSearchErrorUpdate,
	type MessageWebSearchFinishedUpdate,
	type MessageWebSearchGeneralUpdate,
	type MessageWebSearchSourcesUpdate,
} from "$lib/types/MessageUpdate";

export function makeGeneralUpdate(
	update: Pick<MessageWebSearchGeneralUpdate, "message" | "args">
): MessageWebSearchGeneralUpdate {
	return {
		type: MessageUpdateType.WebSearch,
		subtype: MessageWebSearchUpdateType.Update,
		...update,
	};
}

export function makeErrorUpdate(
	update: Pick<MessageWebSearchErrorUpdate, "message" | "args">
): MessageWebSearchErrorUpdate {
	return {
		type: MessageUpdateType.WebSearch,
		subtype: MessageWebSearchUpdateType.Error,
		...update,
	};
}

export function makeSourcesUpdate(sources: WebSearchSource[]): MessageWebSearchSourcesUpdate {
	return {
		type: MessageUpdateType.WebSearch,
		subtype: MessageWebSearchUpdateType.Sources,
		message: "sources",
		sources: sources.map(({ link, title }) => ({ link, title })),
	};
}

export function makeFinalAnswerUpdate(): MessageWebSearchFinishedUpdate {
	return {
		type: MessageUpdateType.WebSearch,
		subtype: MessageWebSearchUpdateType.Finished,
	};
}
