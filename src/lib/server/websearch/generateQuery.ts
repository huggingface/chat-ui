import type { Message } from "$lib/types/Message";
import { format } from "date-fns";
import { generateFromDefaultEndpoint } from "../generateFromDefaultEndpoint";
import { WEBSEARCH_ALLOWLIST, WEBSEARCH_BLOCKLIST } from "$env/static/private";
import { z } from "zod";
import JSON5 from "json5";

const listSchema = z.array(z.string()).default([]);

const allowList = listSchema.parse(JSON5.parse(WEBSEARCH_ALLOWLIST));
const blockList = listSchema.parse(JSON5.parse(WEBSEARCH_BLOCKLIST));

const queryModifier = [
	...allowList.map((item) => "site:" + item),
	...blockList.map((item) => "-site:" + item),
].join(" ");

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
		preprompt: `You are tasked with generating web search queries. Give me an appropriate query to answer my question for google search. Answer with only the query. Today is ${currentDate}`,
	});

	return (queryModifier + " " + webQuery).trim();
}
