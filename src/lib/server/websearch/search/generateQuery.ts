import type { Message } from "$lib/types/Message";
import { format } from "date-fns";
import type { EndpointMessage } from "../../endpoints/endpoints";
import { generateFromDefaultEndpoint } from "../../generateFromDefaultEndpoint";
import { getReturnFromGenerator } from "$lib/utils/getReturnFromGenerator";
import { smallModel } from "$lib/server/models";
import type { Tool } from "$lib/types/Tool";
import { getToolOutput } from "$lib/server/tools/getToolOutput";

export async function generateQuery(messages: Message[]) {
	const currentDate = format(new Date(), "MMMM d, yyyy");

	if (smallModel.tools) {
		const webSearchTool = {
			name: "web_search",
			description: "Search the web for information",
			inputs: [
				{
					name: "query",
					type: "str",
					description: "The query to search the web for",
					paramType: "required",
				},
			],
		} as unknown as Tool;

		const endpoint = await smallModel.getEndpoint();
		const query = await getToolOutput({
			messages,
			preprompt: `The user wants you to search the web for information. Give a relevant google search query to answer the question. Answer with only the query. Today is ${currentDate}`,
			tool: webSearchTool,
			endpoint,
		});

		if (query) {
			return query;
		}
	}

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

	const webQuery = await getReturnFromGenerator(
		generateFromDefaultEndpoint({
			messages: convQuery,
			preprompt: `The user wants you to search the web for information. Give a relevant google search query to answer the question. Answer with only the query. Today is ${currentDate}`,
			generateSettings: {
				max_new_tokens: 30,
			},
		})
	);

	return webQuery.trim();
}
