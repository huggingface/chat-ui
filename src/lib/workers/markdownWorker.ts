import type { WebSearchSource } from "$lib/types/WebSearch";
import { getMarked } from "$lib/utils/getMarked";

type IncomingMessage = {
	type: "process";
	content: string;
	sources: WebSearchSource[];
};

type OutgoingMessage = {
	type: "processed";
	content: string;
};

onmessage = async (event) => {
	if (event.data.type !== "process") {
		return;
	}

	const message = event.data as IncomingMessage;
	const { content, sources } = message;
	const marked = getMarked(sources);

	const tokens = marked.lexer(content);

	const processedTokens = await Promise.all(
		tokens.map(async (token) => {
			if (token.type === "code") {
				return {
					type: "code",
					lang: token.lang,
					code: token.text,
				};
			} else {
				return {
					type: "text",
					html: await marked.parse(token.raw),
				};
			}
		})
	);

	postMessage({ type: "processed", tokens: processedTokens } satisfies OutgoingMessage);
};
