import { env } from "$env/dynamic/private";
import { generateFromDefaultEndpoint } from "$lib/server/generateFromDefaultEndpoint";
import type { EndpointMessage } from "../endpoints/endpoints";
import { logger } from "$lib/server/logger";
import { MessageUpdateType, type MessageUpdate } from "$lib/types/MessageUpdate";
import type { Conversation } from "$lib/types/Conversation";
import { getReturnFromGenerator } from "$lib/utils/getReturnFromGenerator";

export async function* generateTitleForConversation(
	conv: Conversation
): AsyncGenerator<MessageUpdate, undefined, undefined> {
	try {
		const userMessage = conv.messages.find((m) => m.role === "user");
		// HACK: detect if the conversation is new
		if (conv.title !== "New Chat" || !userMessage) return;

		const prompt = userMessage.content;
		const title = (await generateTitle(prompt)) ?? "New Chat";

		yield {
			type: MessageUpdateType.Title,
			title,
		};
	} catch (cause) {
		logger.error(Error("Failed whilte generating title for conversation", { cause }));
	}
}

export async function generateTitle(prompt: string) {
	if (env.LLM_SUMMARIZATION !== "true") {
		return prompt.split(/\s+/g).slice(0, 5).join(" ");
	}

	const messages: Array<EndpointMessage> = [
		{
			role: "system",
			content:
				"You are a summarization AI. You'll never answer a user's question directly, but instead summarize the user's request into a single short sentence of four words or less. Always start your answer with an emoji relevant to the summary",
		},
		{ role: "user", content: "Who is the president of Gabon?" },
		{ role: "assistant", content: "🇬🇦 President of Gabon" },
		{ role: "user", content: "Who is Julien Chaumond?" },
		{ role: "assistant", content: "🧑 Julien Chaumond" },
		{ role: "user", content: "what is 1 + 1?" },
		{ role: "assistant", content: "🔢 Simple math operation" },
		{ role: "user", content: "What are the latest news?" },
		{ role: "assistant", content: "📰 Latest news" },
		{ role: "user", content: "How to make a great cheesecake?" },
		{ role: "assistant", content: "🍰 Cheesecake recipe" },
		{ role: "user", content: "what is your favorite movie? do a short answer." },
		{ role: "assistant", content: "🎥 Favorite movie" },
		{ role: "user", content: "Explain the concept of artificial intelligence in one sentence" },
		{ role: "assistant", content: "🤖 AI definition" },
		{ role: "user", content: "Draw a cute cat" },
		{ role: "assistant", content: "🐱 Cute cat drawing" },
		{ role: "user", content: prompt },
	];

	return await getReturnFromGenerator(
		generateFromDefaultEndpoint({
			messages,
			preprompt:
				"You are a summarization AI. Summarize the user's request into a single short sentence of four words or less. Do not try to answer it, only summarize the user's query. Always start your answer with an emoji relevant to the summary",
			generateSettings: {
				max_new_tokens: 15,
			},
		})
	)
		.then((summary) => {
			// add an emoji if none is found in the first three characters
			if (!/\p{Emoji}/u.test(summary.slice(0, 3))) {
				return "💬 " + summary;
			}
			return summary;
		})
		.catch((e) => {
			logger.error(e);
			return null;
		});
}
