import type { Message } from "$lib/types/Message";
import { format } from "date-fns";
import { generateFromDefaultEndpoint } from "../generateFromDefaultEndpoint";
import { defaultModel } from "../models";

export async function generateQuery(messages: Message[]) {
	const currentDate = format(new Date(), "MMMM d, yyyy");
	const userMessages = messages.filter(({ from }) => from === "user");
	const previousUserMessages = userMessages.slice(0, -1);
	const lastMessage = userMessages.slice(-1)[0];
	const promptSearchQuery = defaultModel.webSearchQueryPromptRender({
		message: lastMessage,
		previousMessages: previousUserMessages.map(({ content }) => content).join(" "),
		currentDate,
	});
	const searchQuery = await generateFromDefaultEndpoint(promptSearchQuery).then((query) => {
		// example of generating google query:
		// user: tell me what happened yesterday
		// LLM: google query is "news september 12, 2023"
		// the regex below will try to capture the last "phrase" (i.e. words between quotes or double quotes or ticks)
		// in this case, it is "news september 12, 2023"
		// if there is no "phrase", we will just use the user query, which was "tell me what happened yesterday"
		const regexLastPhrase = /("|'|`)((?:(?!\1).)+)\1$/;
		const match = query.match(regexLastPhrase);
		return match ? match[2] : lastMessage.content;
	});

	return searchQuery;
}
