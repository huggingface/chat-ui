import { z } from "zod";
import type { Endpoint } from "../endpoints";
import type { TextGenerationStreamOutput } from "@huggingface/inference";
import { createImageProcessorOptionsValidator } from "../images";
import { endpointMessagesToAnthropicMessages } from "./utils";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages.mjs";

export const endpointAnthropicVertexParametersSchema = z.object({
	weight: z.number().int().positive().default(1),
	model: z.any(),
	type: z.literal("anthropic-vertex"),
	region: z.string().default("us-central1"),
	projectId: z.string(),
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

export async function endpointAnthropicVertex(
	input: z.input<typeof endpointAnthropicVertexParametersSchema>
): Promise<Endpoint> {
	const { region, projectId, model, defaultHeaders, defaultQuery, multimodal } =
		endpointAnthropicVertexParametersSchema.parse(input);
	let AnthropicVertex;
	try {
		AnthropicVertex = (await import("@anthropic-ai/vertex-sdk")).AnthropicVertex;
	} catch (e) {
		throw new Error("Failed to import @anthropic-ai/vertex-sdk", { cause: e });
	}

	const anthropic = new AnthropicVertex({
		baseURL: `https://${region}-aiplatform.googleapis.com/v1`,
		region,
		projectId,
		defaultHeaders,
		defaultQuery,
	});

	return async ({ messages, preprompt }) => {
		let system = preprompt;
		if (messages?.[0]?.from === "system") {
			system = messages[0].content;
		}

		let tokenId = 0;
		return (async function* () {
			const stream = anthropic.messages.stream({
				model: model.id ?? model.name,
				messages: (await endpointMessagesToAnthropicMessages(
					messages,
					multimodal
				)) as MessageParam[],
				max_tokens: model.parameters?.max_new_tokens,
				temperature: model.parameters?.temperature,
				top_p: model.parameters?.top_p,
				top_k: model.parameters?.top_k,
				stop_sequences: model.parameters?.stop,
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
