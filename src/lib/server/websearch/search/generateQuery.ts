import type { Message } from "$lib/types/Message";
import { format } from "date-fns";
import type { EndpointMessage } from "../../endpoints/endpoints";
import { generateFromDefaultEndpoint } from "../../generateFromDefaultEndpoint";

export async function generateQuery(messages: Message[]) {
	const currentDate = format(new Date(), "MMMM d, yyyy");
	const userMessages = messages.filter(({ from }) => from === "user");
	const previousUserMessages = userMessages.slice(0, -1);

	const lastMessage = userMessages.slice(-1)[0];

	const convQuery: Array<EndpointMessage> = [
		{
			from: "user",
			content: `Previous Questions:
- Who is the president of France?

Current Question: What about Mexico?
`,
		},
		{
			from: "assistant",
			content: "President of Mexico",
		},
		{
			from: "user",
			content: `Previous questions: 
- When is the next formula 1 grand prix?

Current Question: Where is it being hosted?`,
		},
		{
			from: "assistant",
			content: "location of next formula 1 grand prix",
		},
		{
			from: "user",
			content: "Current Question: What type of printhead does the Epson F2270 DTG printer use?",
		},
		{
			from: "assistant",
			content: "Epson F2270 DTG printer printhead",
		},
		{ from: "user", content: "What were the news yesterday?" },
		{
			from: "assistant",
			content: `news ${format(new Date(Date.now() - 864e5), "MMMM d, yyyy")}`,
		},
		{ from: "user", content: "What is the current weather in Paris?" },
		{ from: "assistant", content: `weather in Paris ${currentDate}` },
		{
			from: "user",
			content:
				(previousUserMessages.length > 0
					? `Previous questions: \n${previousUserMessages
							.map(({ content }) => `- ${content}`)
							.join("\n")}`
					: "") +
				"\n\nCurrent Question: " +
				lastMessage.content,
		},
	];

	const webQuery = await generateFromDefaultEndpoint({
		messages: convQuery,
		preprompt: `You are an expert in crafting concise and effective web search queries. However, keep in that sometimes you may encounter completely unfamiliar terms or concepts. When faced with such uncertainty, please refrain from attempting to substitute or interpret the term in any way. Instead, prioritize maintaining the integrity of the original phrasing as much as possible. Please only provide the query, without answering the question directly.  Your task is to give me the best possible query to answer the user's question on Google Search. Today's date is ${currentDate}`,
		generateSettings: {
			max_new_tokens: 40,
		},
	});

	return webQuery.trim();
}
