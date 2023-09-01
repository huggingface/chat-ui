import type { Message } from "$lib/types/Message";
import { generateFromDefaultEndpoint } from "../generateFromDefaultEndpoint";
import { defaultModel } from "../models";

export async function generateQuery(messages: Message[]) {
	const promptSearchQuery = defaultModel.webSearchQueryPromptRender({ messages });
	const searchQuery = await generateFromDefaultEndpoint(promptSearchQuery).then((query) => {
		const regexLastPhrase = /("|'|`)((?:(?!\1).)+)\1$/;
		const match = query.match(regexLastPhrase);
		return match ? match[2] : promptSearchQuery;
	});

	return searchQuery;
}
