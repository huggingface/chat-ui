import { config } from "$lib/server/config";
import { generateFromDefaultEndpoint } from "$lib/server/generateFromDefaultEndpoint";
import { logger } from "$lib/server/logger";
import { MessageUpdateType, type MessageUpdate } from "$lib/types/MessageUpdate";
import type { Conversation } from "$lib/types/Conversation";
import { getReturnFromGenerator } from "$lib/utils/getReturnFromGenerator";
import { taskModel } from "../models";
import type { Tool } from "$lib/types/Tool";
import { getToolOutput } from "../tools/getToolOutput";

export async function* generateTitleForConversation(
	conv: Conversation
): AsyncGenerator<MessageUpdate, undefined, undefined> {
	try {
		const userMessage = conv.messages.find((m) => m.from === "user");
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
	if (config.LLM_SUMMARIZATION !== "true") {
		return prompt.split(/\s+/g).slice(0, 5).join(" ");
	}

	if (taskModel.tools) {
		const titleTool = {
			name: "title",
			description:
				"Submit a title for the conversation so far. Do not try to answer the user question or the tool will fail.",
			inputs: [
				{
					name: "title",
					type: "str",
					description:
						"The title for the conversation. It should be 5 words or less and start with a unicode emoji relevant to the query.",
				},
			],
		} as unknown as Tool;

		const endpoint = await taskModel.getEndpoint();
		const title = await getToolOutput({
			messages: [
				{
					from: "user" as const,
					content: prompt,
				},
			],
			preprompt:
				"The task is to generate conversation titles based on text snippets. You'll never answer the provided question directly, but instead summarize the user's request into a short title.",
			tool: titleTool,
			endpoint,
		});

		if (title) {
			if (!/\p{Emoji}/u.test(title.slice(0, 3))) {
				return "💬 " + title;
			}
			return title;
		}
	}

	return await getReturnFromGenerator(
		generateFromDefaultEndpoint({
			messages: [{ from: "user", content: prompt }],
			preprompt:
				"You are a summarization AI. Summarize the user's request into a single short sentence of four words or less. Do not try to answer it, only summarize the user's query. Always start your answer with an emoji relevant to the summary",
			generateSettings: {
				max_new_tokens: 30,
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
