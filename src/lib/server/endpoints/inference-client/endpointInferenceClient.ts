import { z } from "zod";
import type { Endpoint, TextGenerationStreamOutputWithToolsAndWebSources } from "../endpoints";
import { createImageProcessorOptionsValidator, makeImageProcessor } from "../images";
import { INFERENCE_PROVIDERS, InferenceClient } from "@huggingface/inference";
import { config } from "$lib/server/config";
import type { ChatCompletionStreamOutput } from "@huggingface/tasks";
import { logger } from "$lib/server/logger";
import type { MessageFile } from "$lib/types/Message";
import { v4 as uuidv4 } from "uuid";
import type { Conversation } from "$lib/types/Conversation";
import { downloadFile } from "$lib/server/files/downloadFile";
import { jsonrepair } from "jsonrepair";

export const endpointInferenceClientParametersSchema = z.object({
	type: z.literal("inference-client"),
	weight: z.number().int().positive().default(1),
	model: z.any(),
	provider: z.enum(INFERENCE_PROVIDERS).optional(),
	modelName: z.string().optional(),
	baseURL: z.string().optional(),
	multimodal: z
		.object({
			image: createImageProcessorOptionsValidator({
				supportedMimeTypes: [
					"image/png",
					"image/jpeg",
					"image/webp",
					"image/avif",
					"image/tiff",
					"image/gif",
				],
				preferredMimeType: "image/webp",
				maxSizeInMB: Infinity,
				maxWidth: 4096,
				maxHeight: 4096,
			}),
		})
		.default({}),
	customHeaders: z.record(z.string(), z.string()).default({}),
});

export async function endpointInferenceClient(
	input: z.input<typeof endpointInferenceClientParametersSchema>
): Promise<Endpoint> {
	const { model, provider, modelName, baseURL, multimodal, customHeaders } =
		endpointInferenceClientParametersSchema.parse(input);

	if (!!provider && !!baseURL) {
		throw new Error("provider and baseURL cannot both be provided");
	}
	const client = baseURL
		? new InferenceClient(config.HF_TOKEN, { endpointUrl: baseURL })
		: new InferenceClient(config.HF_TOKEN);

	const imageProcessor = multimodal.image ? makeImageProcessor(multimodal.image) : undefined;

	async function prepareFiles(files: MessageFile[], conversationId?: Conversation["_id"]) {
		if (!imageProcessor) {
			return [];
		}
		const processedFiles = await Promise.all(
			files
				.filter((file) => file.mime.startsWith("image/"))
				.map(async (file) => {
					if (file.type === "hash" && conversationId) {
						file = await downloadFile(file.value, conversationId);
					}
					return imageProcessor(file);
				})
		);
		return processedFiles.map((file) => ({
			type: "image_url" as const,
			image_url: {
				url: `data:${file.mime};base64,${file.image.toString("base64")}`,
			},
		}));
	}

    return async ({ messages, generateSettings, preprompt, conversationId }) => {
		/* eslint-disable @typescript-eslint/no-explicit-any */
		let messagesArray = (await Promise.all(
			messages.map(async (message) => {
				return {
					role: message.from,
					content: [
						...(await prepareFiles(message.files ?? [], conversationId)),
						{ type: "text" as const, text: message.content },
					],
				};
			})
		)) as any[];

		if (
			!model.systemRoleSupported &&
			messagesArray.length > 0 &&
			messagesArray[0]?.role === "system"
		) {
			messagesArray[0].role = "user";
		} else if (messagesArray[0].role !== "system") {
			messagesArray.unshift({
				role: "system",
				content: preprompt ?? "",
			});
		}

        // Tools integration removed

		messagesArray = messagesArray.reduce((acc: typeof messagesArray, current) => {
			if (acc.length === 0 || current.role !== acc[acc.length - 1].role) {
				acc.push(current);
			} else {
				const prevMessage = acc[acc.length - 1];

				prevMessage.content = [
					...prevMessage.content.filter((item: any) => item.type !== "text"),
					...current.content.filter((item: any) => item.type !== "text"),
					{
						type: "text" as const,
						text: [
							...prevMessage.content.filter((item: any) => item.type === "text"),
							...current.content.filter((item: any) => item.type === "text"),
						]
							.map((item: any) => item.text)
							.join("\n")
							.replace(/^\n/, ""),
					},
				];

				prevMessage.files = [...(prevMessage?.files ?? []), ...(current?.files ?? [])];

				prevMessage.tool_calls = [
					...(prevMessage?.tool_calls ?? []),
					...(current?.tool_calls ?? []),
				];
			}
			return acc;
		}, []);
        const stream = client.chatCompletionStream(
            {
                ...model.parameters,
                ...generateSettings,
                model: modelName ?? model.id ?? model.name,
                provider: baseURL ? undefined : provider || ("hf-inference" as const),
                messages: messagesArray,
            },
        );

        let tokenId = 0;
        let generated_text = "";

		async function* convertStream(): AsyncGenerator<
			TextGenerationStreamOutputWithToolsAndWebSources,
			void,
			void
		> {
            for await (const chunk of stream) {
                const token = chunk.choices?.[0]?.delta?.content || "";

                generated_text += token;

                yield {
                    token: {
                        id: tokenId++,
                        text: token,
                        logprob: 0,
                        special: false,
                    },
                    details: null,
                    generated_text: null,
                };
            }
            yield {
                token: {
                    id: tokenId++,
                    text: "",
                    logprob: 0,
                    special: true,
                },
                generated_text,
                details: null,
            };
        }

		return convertStream();
	};
}
