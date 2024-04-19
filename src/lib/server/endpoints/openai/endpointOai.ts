import { z } from "zod";
import { openAICompletionToTextGenerationStream } from "./openAICompletionToTextGenerationStream";
import { openAIChatToTextGenerationStream } from "./openAIChatToTextGenerationStream";
import { CompletionCreateParamsStreaming } from "openai/resources/completions";
import { ChatCompletionCreateParamsStreaming } from "openai/resources/chat/completions";
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
	defaultHeaders: z.record(z.string()).optional(),
	defaultQuery: z.record(z.string()).optional(),
});

export async function endpointOai(
	input: z.input<typeof endpointOAIParametersSchema>
): Promise<Endpoint> {
	const { baseURL, apiKey, completion, model, defaultHeaders, defaultQuery } =
		endpointOAIParametersSchema.parse(input);
	let OpenAI;
	try {
		OpenAI = (await import("openai")).OpenAI;
	} catch (e) {
		throw new Error("Failed to import OpenAI", { cause: e });
	}

	const openai = new OpenAI({
		apiKey: apiKey ?? "sk-",
		baseURL,
		defaultHeaders,
		defaultQuery,
	});

	if (completion === "completions") {
		return async ({ messages, preprompt, continueMessage, generateSettings }) => {
			const prompt = await buildPrompt({
				messages,
				continueMessage,
				preprompt,
				model,
			});

			const parameters = { ...model.parameters, ...generateSettings };
			const body: CompletionCreateParamsStreaming = {
				model: model.id ?? model.name,
				prompt,
				stream: true,
				max_tokens: parameters?.max_new_tokens,
				stop: parameters?.stop,
				temperature: parameters?.temperature,
				top_p: parameters?.top_p,
				frequency_penalty: parameters?.repetition_penalty,
			};

			let openAICompletion;
			if (parameters.extra_body) {
				/* If extra_body is set, add it to the request using options.
				Used in openai compatible implementations like vllm. */
				const combinedBody = {...body, ...parameters.extra_body};
				openAICompletion = await openai.completions.create(body, {'body': combinedBody});
			} else {
				openAICompletion = await openai.completions.create(body);
			}

			return openAICompletionToTextGenerationStream(openAICompletion);
		};
	} else if (completion === "chat_completions") {
		return async ({ messages, preprompt, generateSettings }) => {
			let messagesOpenAI = messages.map((message) => ({
				role: message.from,
				content: message.content,
			}));

			if (messagesOpenAI?.[0]?.role !== "system") {
				messagesOpenAI = [{ role: "system", content: "" }, ...messagesOpenAI];
			}

			if (messagesOpenAI?.[0]) {
				messagesOpenAI[0].content = preprompt ?? "";
			}

			const parameters = { ...model.parameters, ...generateSettings };
			const body: ChatCompletionCreateParamsStreaming = {
				model: model.id ?? model.name,
				messages: messagesOpenAI,
				stream: true,
				max_tokens: parameters?.max_new_tokens,
				stop: parameters?.stop,
				temperature: parameters?.temperature,
				top_p: parameters?.top_p,
				frequency_penalty: parameters?.repetition_penalty,
			}

			let openChatAICompletion;
			if (parameters.extra_body) {
				/* If extra_body is set, add it to the request using options.
				Used in openai compatible implementations like vllm. */
				const combinedBody = {...body, ...parameters.extra_body};
				openChatAICompletion = await openai.chat.completions.create(body, {'body': combinedBody});
			} else {
				openChatAICompletion = await openai.chat.completions.create(body);
			}

			return openAIChatToTextGenerationStream(openChatAICompletion);
		};
	} else {
		throw new Error("Invalid completion type");
	}
}
