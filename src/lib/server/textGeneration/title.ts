import { config } from "$lib/server/config";
import { generateFromDefaultEndpoint } from "$lib/server/generateFromDefaultEndpoint";
import { logger } from "$lib/server/logger";
import { MessageUpdateType, type MessageUpdate } from "$lib/types/MessageUpdate";
import type { Conversation } from "$lib/types/Conversation";
import { getReturnFromGenerator } from "$lib/utils/getReturnFromGenerator";

export async function* generateTitleForConversation(
	conv: Conversation
): AsyncGenerator<MessageUpdate, undefined, undefined> {
	try {
		const userMessage = conv.messages.find((m) => m.from === "user");
		// HACK: detect if the conversation is new
		if (conv.title !== "New Chat" || !userMessage) return;

		const prompt = userMessage.content;
		const modelForTitle = config.TASK_MODEL?.trim() ? config.TASK_MODEL : conv.model;
		const title = (await generateTitle(prompt, modelForTitle)) ?? "New Chat";

		yield {
			type: MessageUpdateType.Title,
			title,
		};
	} catch (cause) {
		logger.error(Error("Failed whilte generating title for conversation", { cause }));
	}
}

export async function generateTitle(prompt: string, modelId?: string) {
	if (config.LLM_SUMMARIZATION !== "true") {
		// When summarization is disabled, use the first five words without adding emojis
		return prompt.split(/\s+/g).slice(0, 5).join(" ");
	}

	// Tools removed: no tool-based title path

	return await getReturnFromGenerator(
		generateFromDefaultEndpoint({
			messages: [{ from: "user", content: prompt }],
			preprompt:
				"You are a summarization AI. Summarize the user's request into a single short sentence of four words or less. Do not try to answer it; only summarize the user's query.",
			generateSettings: {
				max_new_tokens: 30,
				temperature: 0,
			},
			modelId,
		})
	)
		.then((summary) => {
			const firstFive = prompt.split(/\s+/g).slice(0, 5).join(" ");
			const trimmed = summary.trim();
			// Fallback: if empty, return first five words only (no emoji)
			return trimmed || firstFive;
		})
		.catch((e) => {
			logger.error(e);
			const firstFive = prompt.split(/\s+/g).slice(0, 5).join(" ");
			return firstFive;
		});
}
