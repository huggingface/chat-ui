import type { Message } from "$lib/types/Message";
import { format } from "date-fns";
import { generateFromDefaultEndpoint } from "../generateFromDefaultEndpoint";
import { smallModel } from "../models";

export async function generateQuery(messages: Message[]) {
	const currentDate = format(new Date(), "MMMM d, yyyy");
	const userMessages = messages.filter(({ from }) => from === "user");
	const previousUserMessages = userMessages.slice(0, -1);

	const lastMessage = userMessages.slice(-1)[0];

	const convQuery: Array<Omit<Message, "id">> = [
		{
			from: "user",
			content: `Previous Questions:
- Who is the president of France?

Current Question: What about Mexico?
`,
		},
		{
			from: "assistant",
			content: 'query: "President of Mexico"',
		},
		{
			from: "user",
			content: `Previous questions: 
- When is the next formula 1 grand prix?

Current Question: Where is it being hosted ?`,
		},
		{
			from: "assistant",
			content: 'query: "location of next formula 1 grand prix"',
		},
		{
			from: "user",
			content: "Current Question: What type of printhead does the Epson F2270 DTG printer use?",
		},
		{
			from: "assistant",
			content: 'query: "Epson F2270 DTG printer printhead"',
		},
		{
			from: "user",
			content:
				(previousUserMessages.length > 0
					? `Previous questions: \n${previousUserMessages
							.map(({ content }) => `- ${content}`)
							.join("\n")}`
					: "") +
				"\n\nCurrent Question:" +
				lastMessage.content,
		},
	];

	const promptQuery = smallModel.chatPromptRender({
		preprompt: `You are tasked with generating web search queries. Give me an appropriate query to answer my question for google search. Your answer should follow the format \`query:"[query here]\`. Today is ${currentDate}`,
		messages: convQuery,
	});

	const searchQuery = await generateFromDefaultEndpoint(promptQuery).then((query) => {
		// example of generating google query:
		// case 1
		// user: tell me what happened yesterday
		// LLM: google query is "news september 12, 2023"
		// the regex below will try to capture the last "phrase" (i.e. words between quotes or double quotes or ticks)
		// in this case, it is "news september 12, 2023"
		// if there is no "phrase", we will just use the user query, which was "tell me what happened yesterday"
		const regexLastPhrase = /("|'|`)((?:(?!\1).)+)\1$/;
		let match = query.match(regexLastPhrase);
		if (match) {
			return match[2];
		}

		// case 2
		// user: tell me what happened yesterday
		// LLM: Here is a query: news september 12, 2023
		// the regex below will try to capture the last sentences starting from :
		// in this case, it is "news september 12, 2023"
		// if there is no math, we will just use the user query, which was "tell me what happened yesterday"
		const regexColon = /:\s(.*)$/;
		match = query.match(regexColon);
		if (match) {
			return match[1];
		}

		return lastMessage.content;
	});

	return searchQuery;
}
