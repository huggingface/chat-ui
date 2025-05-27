import { config } from "$lib/server/config";
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
import { findRepoRoot } from "$lib/server/findRepoRoot";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { logger } from "$lib/server/logger";
import type { LlamaContextSequence } from "node-llama-cpp";
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
	const {
		modelPath: modelPathInput,
		multimodal,
		model,
	} = endpointLocalParametersSchema.parse(input);

	// Setup model path and folder
	const path = modelPathInput ?? `hf:${model.id ?? model.name}`;
	const modelFolder =
		config.MODELS_STORAGE_PATH ||
		join(findRepoRoot(dirname(fileURLToPath(import.meta.url))), "models");

	// Initialize Llama model

	const { getLlama, LlamaChatSession, resolveModelFile } = await import("node-llama-cpp");

	const modelPath = await resolveModelFile(path, modelFolder);

	const llama = await getLlama({
		logger: (level, message) => {
			switch (level) {
				case "fatal":
					logger.fatal(message);
					break;
				case "error":
					logger.error(message);
					break;
				case "warn":
					logger.warn(message);
					break;
				case "info":
					logger.info(message);
					break;
				case "log":
					logger.info(message); // Map 'log' to 'info' since pino doesn't have a 'log' level
					break;
				case "debug":
					logger.debug(message);
					break;
				default:
					break;
			}
		},
	});

	if (!llama) {
		throw new Error("Failed to initialize llama.cpp build.");
	}
	const modelLoaded = await llama.loadModel({
		modelPath,
	});
	// Create context and image processor
	const context = await modelLoaded.createContext({ sequences: 1 });
	const imageProcessor = makeImageProcessor(multimodal.image);

	return async function ({
		messages,
		preprompt,
		continueMessage,
		generateSettings,
		// tools,
		// toolResults,
		isMultimodal,
	}) {
		// Process messages and build prompt
		const processedMessages = await Promise.all(
			messages.map((msg) => prepareMessage(Boolean(isMultimodal), msg, imageProcessor))
		);

		let sequence: LlamaContextSequence;
		try {
			sequence = context.getSequence();
		} catch (error) {
			logger.error(error, `Error getting sequence`);
			throw error;
		}

		const chatSession = new LlamaChatSession({
			contextSequence: sequence,
			systemPrompt: preprompt,
		});

		chatSession.setChatHistory(
			messages.slice(0, -1).map((message) => {
				switch (message.from) {
					case "user":
						return {
							type: "user",
							text: message.content,
						};
					case "assistant":
						return {
							type: "model",
							response: [message.content],
						};
					case "system":
						return {
							type: "system",
							text: message.content,
						};
				}
			})
		);

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

			const options = {
				maxTokens: generateSettings?.max_new_tokens,
				temperature: generateSettings?.temperature ?? 0.2,
				topP: generateSettings?.top_p ?? 0.9,
				topK: generateSettings?.top_k ?? 40,
				onTextChunk: (text: string) => {
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
			};

			let generationPromise;
			if (!continueMessage)
				// Start the token generation process
				generationPromise = chatSession.prompt(
					processedMessages[processedMessages.length - 1].content,
					options
				);
			else {
				generationPromise = chatSession.completePrompt(
					processedMessages[processedMessages.length - 1].content,
					options
				);
			}

			try {
				// Yield tokens as they become available
				while (!generationCompleted || queue.length > 0) {
					if (queue.length === 0) {
						const output =
							await new Promise<TextGenerationStreamOutputWithToolsAndWebSources | null>(
								(resolve) => (waitingResolve = resolve)
							);

						// When output is null, it indicates generation completion.
						if (output === null || !output.token.text) break;
						if (model.parameters.stop_sequences?.includes(output.token.text)) {
							break;
						}
						yield output;
					} else {
						const output = queue.shift();
						if (output) yield output;
					}
				}

				// Wait for the generation process to complete (and catch errors if any)
				await generationPromise.finally(() => {
					generationCompleted = true;
					// Resolve any pending waiters so the loop can end.
					if (waitingResolve) {
						waitingResolve(null);
						waitingResolve = null;
					}
				});

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
				logger.error(error, `Generation error`);
				// Ensure we clean up the LlamaManager in case of errors
				throw error;
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
