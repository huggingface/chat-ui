import { env } from "$env/dynamic/private";
import { buildPrompt } from "$lib/buildPrompt";
import type {
	Endpoint,
	EndpointMessage,
	TextGenerationStreamOutputWithToolsAndWebSources,
} from "../endpoints";
import { z } from "zod";
import {
	createImageProcessorOptionsValidator,
	makeImageProcessor,
	type ImageProcessor,
} from "../images";

import { getLlama, LlamaCompletion, resolveModelFile } from "node-llama-cpp";
import { findRepoRoot } from "$lib/server/findRepoRoot";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { logger } from "$lib/server/logger";

export const endpointLocalParametersSchema = z.object({
	weight: z.number().int().positive().default(1),
	model: z.any(),
	modelPath: z.string().optional(),
	type: z.literal("local"),
	multimodal: z
		.object({
			// Assumes IDEFICS
			image: createImageProcessorOptionsValidator({
				supportedMimeTypes: ["image/jpeg", "image/webp"],
				preferredMimeType: "image/webp",
				maxSizeInMB: 5,
				maxWidth: 378,
				maxHeight: 980,
			}),
		})
		.default({}),
});

export async function endpointLocal(
	input: z.input<typeof endpointLocalParametersSchema>
): Promise<Endpoint> {
	const { modelPath, multimodal, model } = endpointLocalParametersSchema.parse(input);

	const path = modelPath ?? `hf:${model.id ?? model.name}`;

	const modelFolder =
		env.MODELS_STORAGE_PATH ||
		join(findRepoRoot(dirname(fileURLToPath(import.meta.url))), "models");

	const llama = await getLlama();
	const modelLoaded = await llama.loadModel({
		modelPath: await resolveModelFile(path, modelFolder),
	});

	const context = await modelLoaded.createContext({
		sequences: 4,
	});

	const imageProcessor = makeImageProcessor(multimodal.image);

	return async ({
		messages,
		preprompt,
		continueMessage,
		generateSettings,
		tools,
		toolResults,
		isMultimodal,
	}) => {
		const messagesWithResizedFiles = await Promise.all(
			messages.map((message) => prepareMessage(Boolean(isMultimodal), message, imageProcessor))
		);

		const prompt = await buildPrompt({
			messages: messagesWithResizedFiles,
			preprompt,
			model,
			continueMessage,
			tools,
			toolResults,
		});

		const completion = new LlamaCompletion({
			contextSequence: context.getSequence(),
		});

		return (async function* () {
			let tokenId = 0;
			let resolver: (() => void) | null = null;
			const queue: TextGenerationStreamOutputWithToolsAndWebSources[] = [];
			let isCompleted = false;
			let emptyTokenCount = 0;
			const EMPTY_TOKEN_THRESHOLD = 3;
			let generatedText = "";
			let endedEarly = false;
			const maxTokens = generateSettings?.max_new_tokens ?? 1000;

			completion
				.generateCompletion(prompt, {
					maxTokens,
					temperature: generateSettings?.temperature,
					topP: generateSettings?.top_p,
					topK: generateSettings?.top_k,
					onTextChunk: (text) => {
						if (endedEarly) {
							return;
						}

						if (text === "") {
							emptyTokenCount++;

							if (emptyTokenCount >= EMPTY_TOKEN_THRESHOLD && !isCompleted) {
								endedEarly = true;
								isCompleted = true;

								queue.push({
									token: {
										id: tokenId++,
										text: "",
										logprob: 0,
										special: true,
									},
									generated_text: generatedText,
									details: null,
								});

								if (resolver) {
									const r = resolver;
									resolver = null;
									r();
								}

								return;
							}

							return;
						} else {
							emptyTokenCount = 0;
						}

						generatedText += text;

						const output: TextGenerationStreamOutputWithToolsAndWebSources = {
							token: {
								id: tokenId++,
								text,
								logprob: 0,
								special: false,
							},
							generated_text: null,
							details: null,
						};

						queue.push(output);

						if (resolver) {
							const r = resolver;
							resolver = null;
							r();
						}
					},
				})
				.then(() => {
					if (!endedEarly && !isCompleted) {
						isCompleted = true;

						queue.push({
							token: {
								id: tokenId++,
								text: "",
								logprob: 0,
								special: true,
							},
							generated_text: generatedText,
							details: null,
						});

						if (resolver) {
							const r = resolver;
							resolver = null;
							r();
						}
					}
				})
				.catch((err) => {
					logger.error(`Completion error: ${err}`);
					if (!isCompleted) {
						isCompleted = true;
						if (resolver) {
							const r = resolver;
							resolver = null;
							r();
						}
					}
				});

			try {
				while (!isCompleted || queue.length > 0) {
					if (queue.length > 0) {
						const chunk = queue.shift();
						if (chunk) {
							yield chunk;
						}
					} else if (!isCompleted) {
						await new Promise<void>((r) => {
							resolver = r;
						});
					}
				}
			} catch (error) {
				logger.error(`Error in generator: ${error}`);
				throw error;
			} finally {
				await context.dispose();
			}
		})();
	};
}

async function prepareMessage(
	isMultimodal: boolean,
	message: EndpointMessage,
	imageProcessor: ImageProcessor
): Promise<EndpointMessage> {
	if (!isMultimodal) return message;
	const files = await Promise.all(message.files?.map(imageProcessor) ?? []);
	const markdowns = files.map(
		(file) => `![](data:${file.mime};base64,${file.image.toString("base64")})`
	);
	const content = message.content + "\n" + markdowns.join("\n ");

	return { ...message, content };
}
