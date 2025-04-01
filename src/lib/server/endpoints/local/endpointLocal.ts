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

import { LlamaCompletion, LlamaContextSequence, resolveModelFile } from "node-llama-cpp";
import { findRepoRoot } from "$lib/server/findRepoRoot";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { logger } from "$lib/server/logger";
import { LlamaManager } from "./utilsLocal";

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
	// Parse and validate input
	const { modelPath, multimodal, model } = endpointLocalParametersSchema.parse(input);

	// Setup model path and folder
	const path = modelPath ?? `hf:${model.id ?? model.name}`;
	const modelFolder =
		env.MODELS_STORAGE_PATH ||
		join(findRepoRoot(dirname(fileURLToPath(import.meta.url))), "models");

	// Initialize Llama model
	const llama = await LlamaManager.getLlama();
	const modelLoaded = await llama.loadModel({
		modelPath: await resolveModelFile(path, modelFolder),
	});
	// Create context and image processor
	const context = await modelLoaded.createContext({ sequences: 1 });
	const imageProcessor = makeImageProcessor(multimodal.image);

	return async function ({
		messages,
		preprompt,
		continueMessage,
		generateSettings,
		tools,
		toolResults,
		isMultimodal,
	}) {
		// Process messages and build prompt
		const processedMessages = await Promise.all(
			messages.map((msg) => prepareMessage(Boolean(isMultimodal), msg, imageProcessor))
		);

		const prompt = await buildPrompt({
			messages: processedMessages,
			preprompt,
			model,
			continueMessage,
			tools,
			toolResults,
		});

		let sequence: LlamaContextSequence;
		try {
			sequence = context.getSequence();
		} catch (error) {
			logger.error(`Error getting sequence: ${error}`);
			await LlamaManager.disposeLlama();
			throw error;
		}
		// Setup completion
		const completion = new LlamaCompletion({
			contextSequence: sequence,
		});

		async function* generateTokens(): AsyncGenerator<TextGenerationStreamOutputWithToolsAndWebSources> {
			let tokenId = 0;
			let fullText = "";
			// A simple queue for tokens that have been produced
			const queue: TextGenerationStreamOutputWithToolsAndWebSources[] = [];
			let waitingResolve:
				| ((value: TextGenerationStreamOutputWithToolsAndWebSources | null) => void)
				| null = null;
			let generationCompleted = false;

			// Helper function to push tokens to the queue
			function pushOutput(output: TextGenerationStreamOutputWithToolsAndWebSources) {
				if (waitingResolve) {
					waitingResolve(output);
					waitingResolve = null;
				} else {
					queue.push(output);
				}
			}

			// Start the token generation process
			const generationPromise = completion
				.generateCompletion(prompt, {
					maxTokens: generateSettings?.max_new_tokens ?? 1000,
					temperature: generateSettings?.temperature,
					topP: generateSettings?.top_p,
					topK: generateSettings?.top_k,
					// onToken: (tokens) => {
					// 	// console.log(modelLoaded.detokenize(tokens));
					// },
					onTextChunk: (text) => {
						if (!text) return;
						// console.log(text);
						fullText += text;
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
						// Instead of returning the token, push it into our queue.
						pushOutput(output);
					},
				})
				.then(() => {
					generationCompleted = true;
					// Resolve any pending waiters so the loop can end.
					if (waitingResolve) {
						waitingResolve(null);
						waitingResolve = null;
					}
					sequence.dispose();
				})
				.catch((error) => {
					generationCompleted = true;
					if (waitingResolve) {
						waitingResolve(null);
						waitingResolve = null;
					}

					sequence.dispose();
					throw error;
				});

			try {
				// Yield tokens as they become available
				while (!generationCompleted || queue.length > 0) {
					if (queue.length === 0) {
						const output =
							await new Promise<TextGenerationStreamOutputWithToolsAndWebSources | null>(
								(resolve) => (waitingResolve = resolve)
							);
						// When output is null, it indicates generation completion.
						if (output === null) break;
						if (model.parameters.stop_sequences?.includes(output.token.text)) {
							console.log("Stop sequence detected");
							break;
						}
						yield output;
					} else {
						const output = queue.shift();
						if (output) yield output;
					}
				}

				// Wait for the generation process to complete (and catch errors if any)
				await generationPromise;

				// Yield a final token that contains the full generated text.
				yield {
					token: {
						id: tokenId,
						text: "",
						logprob: 0,
						special: true,
					},
					generated_text: fullText,
					details: null,
				};
			} catch (error) {
				logger.error(`Generation error: ${error}`);
				throw error;
			} finally {
				sequence.dispose();
			}
		}

		return generateTokens();
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
