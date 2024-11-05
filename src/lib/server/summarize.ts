import { env } from "$env/dynamic/private";
import { generateFromDefaultEndpoint } from "$lib/server/generateFromDefaultEndpoint";
import type { Message } from "$lib/types/Message";
import { logger } from "$lib/server/logger";

export async function summarize(prompt: string) {
	if (!env.LLM_SUMMERIZATION) {
		return prompt.split(/\s+/g).slice(0, 5).join(" ");
	}

	const messages: Array<Omit<Message, "id">> = [
		{ from: "user", content: "Who is the president of Gabon?" },
		{ from: "assistant", content: "🇬🇦 President of Gabon" },
		{ from: "user", content: "Who is Julien Chaumond?" },
		{ from: "assistant", content: "🧑 Julien Chaumond" },
		{ from: "user", content: "what is 1 + 1?" },
		{ from: "assistant", content: "🔢 Simple math operation" },
		{ from: "user", content: "What are the latest news?" },
		{ from: "assistant", content: "📰 Latest news" },
		{ from: "user", content: "How to make a great cheesecake?" },
		{ from: "assistant", content: "🍰 Cheesecake recipe" },
		{ from: "user", content: "what is your favorite movie? do a short answer." },
		{ from: "assistant", content: "🎥 Favorite movie" },
		{ from: "user", content: "Explain the concept of artificial intelligence in one sentence" },
		{ from: "assistant", content: "🤖 AI definition" },
		{ from: "user", content: prompt },
	];

	return await generateFromDefaultEndpoint({
		messages,
		preprompt:
			"You are a summarization AI. Summarize the user's request into a single short sentence of four words or less. Do not try to answer it, only summarize the user's query. Always start your answer with an emoji relevant to the summary",
		generateSettings: {
			max_new_tokens: 15,
		},
	})
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
