import { z } from "zod";
import type { Endpoint } from "../endpoints";
import { env } from "$env/dynamic/private";
import type { TextGenerationStreamOutput } from "@huggingface/inference";
import { createImageProcessorOptionsValidator } from "../images";
import { endpointMessagesToAnthropicMessages } from "./utils";

export const endpointAnthropicParametersSchema = z.object({
	weight: z.number().int().positive().default(1),
	model: z.any(),
	type: z.literal("anthropic"),
	baseURL: z.string().url().default("https://api.anthropic.com"),
	apiKey: z.string().default(env.ANTHROPIC_API_KEY ?? "sk-"),
	defaultHeaders: z.record(z.string()).optional(),
	defaultQuery: z.record(z.string()).optional(),
	multimodal: z
		.object({
			image: createImageProcessorOptionsValidator({
				supportedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
				preferredMimeType: "image/webp",
				// The 4 / 3 compensates for the 33% increase in size when converting to base64
				maxSizeInMB: (5 / 4) * 3,
				maxWidth: 4096,
				maxHeight: 4096,
			}),
		})
		.default({}),
});

export async function endpointAnthropic(
	input: z.input<typeof endpointAnthropicParametersSchema>
): Promise<Endpoint> {
	const { baseURL, apiKey, model, defaultHeaders, defaultQuery, multimodal } =
		endpointAnthropicParametersSchema.parse(input);
	let Anthropic;
	try {
		Anthropic = (await import("@anthropic-ai/sdk")).default;
	} catch (e) {
		throw new Error("Failed to import @anthropic-ai/sdk", { cause: e });
	}

	const anthropic = new Anthropic({
		apiKey,
		baseURL,
		defaultHeaders,
		defaultQuery,
	});

	return async ({ messages, preprompt, generateSettings }) => {
		let system = preprompt;
		if (messages?.[0]?.from === "system") {
			system = messages[0].content;
		}

		let tokenId = 0;

		const parameters = { ...model.parameters, ...generateSettings };

		return (async function* () {
			const stream = anthropic.messages.stream({
				model: model.id ?? model.name,
				messages: await endpointMessagesToAnthropicMessages(messages, multimodal),
				max_tokens: parameters?.max_new_tokens,
				temperature: parameters?.temperature,
				top_p: parameters?.top_p,
				top_k: parameters?.top_k,
				stop_sequences: parameters?.stop,
				system,
			});
			while (true) {
				const result = await Promise.race([stream.emitted("text"), stream.emitted("end")]);

				// Stream end
				if (result === undefined) {
					yield {
						token: {
							id: tokenId++,
							text: "",
							logprob: 0,
							special: true,
						},
						generated_text: await stream.finalText(),
						details: null,
					} satisfies TextGenerationStreamOutput;
					return;
				}

				// Text delta
				yield {
					token: {
						id: tokenId++,
						text: result as unknown as string,
						special: false,
						logprob: 0,
					},
					generated_text: null,
					details: null,
				} satisfies TextGenerationStreamOutput;
			}
		})();
	};
}
