import type { Message } from "$lib/types/Message";
import { format } from "date-fns";
import type { EndpointMessage } from "../../endpoints/endpoints";
import { generateFromDefaultEndpoint } from "../../generateFromDefaultEndpoint";
import { getReturnFromGenerator } from "$lib/utils/getReturnFromGenerator";
import { taskModel } from "$lib/server/models";
import type { Tool } from "$lib/types/Tool";
import { getToolOutput } from "$lib/server/tools/getToolOutput";

export async function generateQuery(messages: Message[]) {
	const currentDate = format(new Date(), "MMMM d, yyyy");

	if (taskModel.tools) {
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

		const endpoint = await taskModel.getEndpoint();
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
			preprompt: `The user wants you to search the web for information. Give a relevant google search query to answer the question. Answer with only the query. Today is ${currentDate}. The conversation follows: \n`,
			generateSettings: {
				max_new_tokens: 30,
			},
		})
	);

	return webQuery.trim().replace(/^"|"$/g, "");
}
