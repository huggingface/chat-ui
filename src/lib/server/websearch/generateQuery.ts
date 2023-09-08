import type { Message } from "$lib/types/Message";
import { format } from "date-fns";
import { generateFromDefaultEndpoint } from "../generateFromDefaultEndpoint";
import { defaultModel } from "../models";

export async function generateQuery(messages: Message[]) {
	const currentDate = format(new Date(), "MMMM d, yyyy");
	const lastMessage = messages[messages.length - 1];
	const promptSearchQuery = defaultModel.webSearchQueryPromptRender({
		message: lastMessage,
		currentDate,
	});
	const searchQuery = await generateFromDefaultEndpoint(promptSearchQuery).then((query) => {
		const regexLastPhrase = /("|'|`)((?:(?!\1).)+)\1$/;
		const match = query.match(regexLastPhrase);
		return match ? match[2] : lastMessage.content;
	});

	return searchQuery;
}
