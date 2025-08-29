import { config } from "$lib/server/config";
import { generateFromDefaultEndpoint } from "$lib/server/generateFromDefaultEndpoint";
import { logger } from "$lib/server/logger";
import { MessageUpdateType, type MessageUpdate } from "$lib/types/MessageUpdate";
import type { Conversation } from "$lib/types/Conversation";
import { getReturnFromGenerator } from "$lib/utils/getReturnFromGenerator";
// taskModel no longer used directly here; we pass the current model instead

export async function* generateTitleForConversation(
	conv: Conversation
): AsyncGenerator<MessageUpdate, undefined, undefined> {
	try {
		const userMessage = conv.messages.find((m) => m.from === "user");
		// HACK: detect if the conversation is new
		if (conv.title !== "New Chat" || !userMessage) return;

		const prompt = userMessage.content;
		const title = (await generateTitle(prompt, conv.model)) ?? "New Chat";

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
        return prompt.split(/\s+/g).slice(0, 5).join(" ");
    }

	// Tools removed: no tool-based title path

    return await getReturnFromGenerator(
        generateFromDefaultEndpoint({
            messages: [{ from: "user", content: prompt }],
            preprompt:
                "You are a summarization AI. Summarize the user's request into a single short sentence of four words or less. Do not try to answer it, only summarize the user's query. Always start your answer with an emoji relevant to the summary",
            generateSettings: {
                max_new_tokens: 30,
            },
            modelId,
        })
    )
		.then((summary) => {
			const firstFive = prompt.split(/\s+/g).slice(0, 5).join(" ");
			const trimmed = summary.trim();
			// Fallback: if empty, use emoji + first five words
			if (!trimmed) {
				return "💬 " + firstFive;
			}
			// Ensure emoji prefix if missing
			if (!/\p{Emoji}/u.test(trimmed.slice(0, 3))) {
				return "💬 " + trimmed;
			}
			return trimmed;
		})
		.catch((e) => {
			logger.error(e);
			const firstFive = prompt.split(/\s+/g).slice(0, 5).join(" ");
			return "💬 " + firstFive;
		});
}
