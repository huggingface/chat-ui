import { config } from "$lib/server/config";
import { generateFromDefaultEndpoint } from "$lib/server/generateFromDefaultEndpoint";
import { logger } from "$lib/server/logger";
import { getReturnFromGenerator } from "$lib/utils/getReturnFromGenerator";

export async function generateGroupName(
	titles: string[],
	locals: App.Locals | undefined
): Promise<string | null> {
	try {
		if (titles.length === 0) return null;

		if (config.LLM_SUMMARIZATION !== "true") {
			return titles[0];
		}

		const titlesStr = titles.map((t) => `- "${t}"`).join("\n");

		const name = await getReturnFromGenerator(
			generateFromDefaultEndpoint({
				messages: [{ from: "user", content: `Conversation titles:\n${titlesStr}` }],
				preprompt: `You are a conversation group naming assistant.
Goal: Given a list of conversation titles, produce a very short name (2-4 words) that captures their shared theme or topic.

Rules:
- Output ONLY the group name text. No prefixes, labels, quotes, emojis, hashtags, or trailing punctuation.
- Use the language of the conversation titles.
- Write a concise noun phrase.
- Never include meta-words: Group, Folder, Collection, Category, Conversations.

Examples:
Titles: "Python string reversal", "List comprehensions", "Django ORM tips" -> Python Programming
Titles: "NYC weekend plan", "Best restaurants Manhattan", "Central Park guide" -> New York Travel

Return only the group name text.`,
				generateSettings: {
					max_tokens: 24,
					temperature: 0,
				},
				locals,
			})
		);

		const trimmed = String(name ?? "").trim();
		return trimmed || titles[0];
	} catch (e) {
		logger.error(e, "Error generating group name");
		return titles[0];
	}
}
