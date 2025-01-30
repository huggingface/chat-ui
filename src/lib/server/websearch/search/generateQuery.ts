import type { Message } from "$lib/types/Message";
import { format } from "date-fns";
import type { EndpointMessage } from "../../endpoints/endpoints";
import { generateFromDefaultEndpoint } from "../../generateFromDefaultEndpoint";
import { getReturnFromGenerator } from "$lib/utils/getReturnFromGenerator";

export async function generateQuery(messages: Message[]) {
	const currentDate = format(new Date(), "MMMM d, yyyy");
	const userMessages = messages.filter(({ role }) => role === "user");
	const previousUserMessages = userMessages.slice(0, -1);

	const lastMessage = userMessages.slice(-1)[0];

	const convQuery: Array<EndpointMessage> = [
		{
			role: "user",
			content: `Previous Questions:
- Who is the president of France?

Current Question: What about Mexico?
`,
		},
		{
			role: "assistant",
			content: "President of Mexico",
		},
		{
			role: "user",
			content: `Previous questions: 
- When is the next formula 1 grand prix?

Current Question: Where is it being hosted?`,
		},
		{
			role: "assistant",
			content: "location of next formula 1 grand prix",
		},
		{
			role: "user",
			content: "Current Question: What type of printhead does the Epson F2270 DTG printer use?",
		},
		{
			role: "assistant",
			content: "Epson F2270 DTG printer printhead",
		},
		{ role: "user", content: "What were the news yesterday?" },
		{
			role: "assistant",
			content: `news ${format(new Date(Date.now() - 864e5), "MMMM d, yyyy")}`,
		},
		{ role: "user", content: "What is the current weather in Paris?" },
		{ role: "assistant", content: `weather in Paris ${currentDate}` },
		{
			role: "user",
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

	const webQuery = await getReturnFromGenerator(
		generateFromDefaultEndpoint({
			messages: convQuery,
			preprompt: `You are tasked with generating web search queries. Give me an appropriate query to answer my question for google search. Answer with only the query. Today is ${currentDate}`,
			generateSettings: {
				max_new_tokens: 30,
			},
		})
	);

	return webQuery.trim();
}
