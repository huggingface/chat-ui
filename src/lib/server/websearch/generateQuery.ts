import type { Message } from "$lib/types/Message";
import { generateFromDefaultEndpoint } from "../generateFromDefaultEndpoint";
import type { BackendModel } from "../models";

export async function generateQuery(messages: Message[], model: BackendModel) {
	const promptSearchQuery =
		model.userMessageToken +
		"The following messages were written by a user, trying to answer a question." +
		model.userMessageEndToken +
		messages
			.filter((message) => message.from === "user")
			.map((message) => model.userMessageToken + message.content + model.userMessageEndToken) +
		model.userMessageToken +
		"What plain-text english sentence would you input into Google to answer the last question? Answer with a short (10 words max) simple sentence." +
		model.userMessageEndToken +
		model.assistantMessageToken +
		"Query: ";

	const searchQuery = await generateFromDefaultEndpoint(promptSearchQuery).then((query) => {
		const arr = query.split(/\r?\n/);
		return arr[0].length > 0 ? arr[0] : arr[1];
	});

	return searchQuery;
}
