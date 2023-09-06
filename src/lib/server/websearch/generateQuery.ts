import type { Message } from "$lib/types/Message";
import { generateFromDefaultEndpoint } from "../generateFromDefaultEndpoint";
import { defaultModel } from "../models";

export async function generateQuery(messages: Message[]) {
	const promptSearchQuery = defaultModel.webSearchQueryPromptRender({ messages });
	const searchQuery = await generateFromDefaultEndpoint(promptSearchQuery).then((query) => {
		const arr = query.split(/\r?\n/);
		return arr[0].length > 0 ? arr[0] : arr[1];
	});

	return searchQuery;
}
