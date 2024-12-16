import { z } from "zod";
import type { Endpoint } from "../endpoints";
import type { TextGenerationStreamOutput } from "@huggingface/inference";
import {
	BedrockRuntimeClient,
	InvokeModelWithResponseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { createImageProcessorOptionsValidator, makeImageProcessor } from "../images";
import type { EndpointMessage } from "../endpoints";
import type { MessageFile } from "$lib/types/Message";

export const endpointBedrockParametersSchema = z.object({
	weight: z.number().int().positive().default(1),
	type: z.literal("bedrock"),
	region: z.string().default("us-east-1"),
	model: z.any(),
	anthropicVersion: z.string().default("bedrock-2023-05-31"),
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
});

export async function endpointBedrock(
	input: z.input<typeof endpointBedrockParametersSchema>
): Promise<Endpoint> {
	const { region, model, anthropicVersion, multimodal } =
		endpointBedrockParametersSchema.parse(input);
	const client = new BedrockRuntimeClient({
		region,
	});
	const imageProcessor = makeImageProcessor(multimodal.image);

	return async ({ messages, preprompt, generateSettings }) => {
		let system = preprompt;
		// Use the first message as the system prompt if it's of type "system"
		if (messages?.[0]?.from === "system") {
			system = messages[0].content;
			messages = messages.slice(1); // Remove the first system message from the array
		}

		const formattedMessages = await prepareMessages(messages, model.id, imageProcessor);

		let tokenId = 0;
		const parameters = { ...model.parameters, ...generateSettings };
		return (async function* () {
			const baseCommandParams = {
				contentType: "application/json",
				accept: "application/json",
				modelId: model.id,
				trace: "DISABLED",
			};

			const maxTokens = parameters.max_new_tokens || 4096;

			let bodyContent;
			if (model.id.includes("nova")) {
				bodyContent = {
					messages: formattedMessages,
					inferenceConfig: {
						maxTokens,
						topP: 0.1,
						temperature: 1.0,
					},
					system: [{ text: system }],
				};
			} else {
				bodyContent = {
					anthropic_version: anthropicVersion,
					max_tokens: maxTokens,
					messages: formattedMessages,
					system,
				};
			}

			const command = new InvokeModelWithResponseStreamCommand({
				...baseCommandParams,
				body: Buffer.from(JSON.stringify(bodyContent), "utf-8"),
			});

			console.log(JSON.stringify({ messages: formattedMessages }));

			const response = await client.send(command);

			let text = "";

			for await (const item of response.body ?? []) {
				const chunk = JSON.parse(new TextDecoder().decode(item.chunk?.bytes));

				if ("contentBlockDelta" in chunk || chunk.type === "content_block_delta") {
					const chunkText = chunk.contentBlockDelta?.delta?.text || chunk.delta?.text || "";
					text += chunkText;
					console.log(text);
					yield {
						token: {
							id: tokenId++,
							text: chunkText,
							logprob: 0,
							special: false,
						},
						generated_text: null,
						details: null,
					} satisfies TextGenerationStreamOutput;
				} else if ("messageStop" in chunk || chunk.type === "message_stop") {
					yield {
						token: {
							id: tokenId++,
							text: "",
							logprob: 0,
							special: true,
						},
						generated_text: text,
						details: null,
					} satisfies TextGenerationStreamOutput;
				}
			}
		})();
	};
}

// Prepare the messages excluding system prompts
async function prepareMessages(
	messages: EndpointMessage[],
	modelId: string,
	imageProcessor: ReturnType<typeof makeImageProcessor>
) {
	const formattedMessages = [];
	const nova = modelId.includes("amazon.nova");

	for (const message of messages) {
		const content = [];

		if (message.files?.length) {
			content.push(...(await prepareFiles(imageProcessor, modelId, message.files)));
		}
		if (nova) {
			content.push({ text: message.content });
		} else {
			content.push({ type: "text", text: message.content });
		}

		const lastMessage = formattedMessages[formattedMessages.length - 1];
		if (lastMessage && lastMessage.role === message.from) {
			// If the last message has the same role, merge the content
			lastMessage.content.push(...content);
		} else {
			formattedMessages.push({ role: message.from, content });
		}
	}
	return formattedMessages;
}

// Process files and convert them to base64 encoded strings
async function prepareFiles(
	imageProcessor: ReturnType<typeof makeImageProcessor>,
	modelId: string,
	files: MessageFile[]
) {
	const nova = modelId.includes("amazon.nova");
	const processedFiles = await Promise.all(files.map(imageProcessor));

	if (nova) {
		return processedFiles.map((file) => ({
			image: {
				format: file.mime.substring("image/".length),
				source: { bytes: file.image.toString("base64") },
			},
		}));
	} else {
		return processedFiles.map((file) => ({
			type: "image",
			source: { type: "base64", media_type: file.mime, data: file.image.toString("base64") },
		}));
	}
}
