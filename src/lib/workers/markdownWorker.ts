import type { WebSearchSource } from "$lib/types/WebSearch";
import { processTokens, type Token } from "$lib/utils/marked";

export type IncomingMessage = {
	type: "process";
	content: string;
	sources: WebSearchSource[];
};

export type OutgoingMessage = {
	type: "processed";
	tokens: Token[];
};

onmessage = async (event) => {
	if (event.data.type !== "process") {
		return;
	}

	const message = event.data as IncomingMessage;

	const { content, sources } = message;

	const processedTokens = await processTokens(content, sources);

	postMessage({ type: "processed", tokens: processedTokens } satisfies OutgoingMessage);
};
