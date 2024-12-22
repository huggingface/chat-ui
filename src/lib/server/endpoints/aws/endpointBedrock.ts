import { z } from "zod";
import type { Endpoint } from "../endpoints";
import type { TextGenerationStreamOutput } from "@huggingface/inference";
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

	let BedrockRuntimeClient, InvokeModelWithResponseStreamCommand;
	try {
		({ BedrockRuntimeClient, InvokeModelWithResponseStreamCommand } = await import(
			"@aws-sdk/client-bedrock-runtime"
		));
	} catch (error) {
		throw new Error("Failed to import @aws-sdk/client-bedrock-runtime. Make sure it's installed.");
	}

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

		const formattedMessages = await prepareMessages(messages, imageProcessor);

		let tokenId = 0;
		const parameters = { ...model.parameters, ...generateSettings };
		return (async function* () {
			const command = new InvokeModelWithResponseStreamCommand({
				body: Buffer.from(
					JSON.stringify({
						anthropic_version: anthropicVersion,
						max_tokens: parameters.max_new_tokens ? parameters.max_new_tokens : 4096,
						messages: formattedMessages,
						system,
					}),
					"utf-8"
				),
				contentType: "application/json",
				accept: "application/json",
				modelId: model.id,
				trace: "DISABLED",
			});

			const response = await client.send(command);

			let text = "";

			for await (const item of response.body ?? []) {
				const chunk = JSON.parse(new TextDecoder().decode(item.chunk?.bytes));
				const chunk_type = chunk.type;

				if (chunk_type === "content_block_delta") {
					text += chunk.delta.text;
					yield {
						token: {
							id: tokenId++,
							text: chunk.delta.text,
							logprob: 0,
							special: false,
						},
						generated_text: null,
						details: null,
					} satisfies TextGenerationStreamOutput;
				} else if (chunk_type === "message_stop") {
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
	imageProcessor: ReturnType<typeof makeImageProcessor>
) {
	const formattedMessages = [];

	for (const message of messages) {
		const content = [];

		if (message.files?.length) {
			content.push(...(await prepareFiles(imageProcessor, message.files)));
		}
		content.push({ type: "text", text: message.content });

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
	files: MessageFile[]
) {
	const processedFiles = await Promise.all(files.map(imageProcessor));
	return processedFiles.map((file) => ({
		type: "image",
		source: { type: "base64", media_type: "image/jpeg", data: file.image.toString("base64") },
	}));
}
