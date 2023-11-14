import { z } from "zod";
import { openAICompletionToTextGenerationStream } from "./openAICompletionToTextGenerationStream";
import { openAIChatToTextGenerationStream } from "./openAIChatToTextGenerationStream";
import { buildPrompt } from "$lib/buildPrompt";
import { OPENAI_API_KEY } from "$env/static/private";
import type { Endpoint } from "../endpoints";

export const endpointOAIParametersSchema = z.object({
	weight: z.number().int().positive().default(1),
	model: z.any(),
	type: z.literal("openai"),
	baseURL: z.string().url().default("https://api.openai.com/v1"),
	apiKey: z.string().default(OPENAI_API_KEY ?? "sk-"),
	completion: z
		.union([z.literal("completions"), z.literal("chat_completions")])
		.default("chat_completions"),
});

export async function endpointOai({
	baseURL,
	apiKey,
	completion,
	model,
}: z.infer<typeof endpointOAIParametersSchema>): Promise<Endpoint> {
	let OpenAI;
	try {
		OpenAI = (await import("openai")).OpenAI;
	} catch (e) {
		throw new Error("Failed to import OpenAI", { cause: e });
	}

	const openai = new OpenAI({
		apiKey: apiKey ?? "sk-",
		baseURL: baseURL,
	});

	if (completion === "completions") {
		return async ({ conversation }) => {
			return openAICompletionToTextGenerationStream(
				await openai.completions.create({
					model: model.id ?? model.name,
					prompt: await buildPrompt({
						messages: conversation.messages,
						webSearch: conversation.messages[conversation.messages.length - 1].webSearch,
						preprompt: conversation.preprompt,
						model,
					}),
					stream: true,
					max_tokens: model.parameters?.max_new_tokens,
					stop: model.parameters?.stop,
					temperature: model.parameters?.temperature,
					top_p: model.parameters?.top_p,
					frequency_penalty: model.parameters?.repetition_penalty,
				})
			);
		};
	} else if (completion === "chat_completions") {
		return async ({ conversation }) => {
			const messages = conversation.messages.map((message) => ({
				role: message.from,
				content: message.content,
			}));

			return openAIChatToTextGenerationStream(
				await openai.chat.completions.create({
					model: model.id ?? model.name,
					messages: conversation.preprompt
						? [{ role: "system", content: conversation.preprompt }, ...messages]
						: messages,
					stream: true,
					max_tokens: model.parameters?.max_new_tokens,
					stop: model.parameters?.stop,
					temperature: model.parameters?.temperature,
					top_p: model.parameters?.top_p,
					frequency_penalty: model.parameters?.repetition_penalty,
				})
			);
		};
	} else {
		throw new Error("Invalid completion type");
	}
}
