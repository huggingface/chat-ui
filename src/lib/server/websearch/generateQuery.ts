import type { Message } from "$lib/types/Message";
import { format } from "date-fns";
import { generateFromDefaultEndpoint } from "../generateFromDefaultEndpoint";

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
		preprompt: `You are an expert in crafting concise and effective web search queries. Your task is to generate queries that help users find the latest information and updates on a diverse range of topics and events. You are capable of understanding context and user intentions to provide relevant and timely search strategies. Your responses should be short and precise, covering all the key details that a user might be interested in. Remember to adapt your queries to the dynamic nature of web content, ensuring that the results retrieved are up-to-date and from reliable sources. Make sure to Answer with only the query. Stop generation just after Generating query. Today is ${currentDate}`,
		generateSettings: {
			max_new_tokens: 30,
		},
	});

	return webQuery.trim();
}
