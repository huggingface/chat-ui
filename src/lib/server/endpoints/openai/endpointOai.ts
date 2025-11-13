import { z } from "zod";
import { openAICompletionToTextGenerationStream } from "./openAICompletionToTextGenerationStream";
import {
	openAIChatToTextGenerationSingle,
	openAIChatToTextGenerationStream,
} from "./openAIChatToTextGenerationStream";
import type {
	ChatCompletionCreateParamsNonStreaming,
	ChatCompletionCreateParamsStreaming,
} from "openai/resources/chat/completions";
import { buildPrompt } from "$lib/buildPrompt";
import { config } from "$lib/server/config";
import { env as serverEnv } from "$env/dynamic/private";
import type { Endpoint } from "../endpoints";
import type OpenAI from "openai";
import { createImageProcessorOptionsValidator, makeImageProcessor } from "../images";
import type { MessageFile } from "$lib/types/Message";
import type { EndpointMessage } from "../endpoints";
// uuid import removed (no tool call ids)

export const endpointOAIParametersSchema = z.object({
	weight: z.number().int().positive().default(1),
	model: z.any(),
	type: z.literal("openai"),
	baseURL: z.string().url().default("https://api.openai.com/v1"),
	apiKey: z.string().default(config.OPENAI_API_KEY || "sk-"),
	completion: z
		.union([z.literal("completions"), z.literal("chat_completions")])
		.default("chat_completions"),
	defaultHeaders: z.record(z.string()).optional(),
	defaultQuery: z.record(z.string()).optional(),
	extraBody: z.record(z.any()).optional(),
	multimodal: z
		.object({
			image: createImageProcessorOptionsValidator({
				supportedMimeTypes: [
					// Restrict to the most widely-supported formats
					"image/png",
					"image/jpeg",
				],
				preferredMimeType: "image/jpeg",
				maxSizeInMB: 1,
				maxWidth: 1024,
				maxHeight: 1024,
			}),
		})
		.default({}),
	/* enable use of max_completion_tokens in place of max_tokens */
	useCompletionTokens: z.boolean().default(false),
	streamingSupported: z.boolean().default(false), // Disabled for security handler compatibility
});

export async function endpointOai(
	input: z.input<typeof endpointOAIParametersSchema>
): Promise<Endpoint> {
	const {
		baseURL,
		apiKey,
		completion,
		model,
		defaultHeaders,
		defaultQuery,
		multimodal,
		extraBody,
		useCompletionTokens,
		streamingSupported,
	} = endpointOAIParametersSchema.parse(input);

	let OpenAI;
	try {
		OpenAI = (await import("openai")).OpenAI;
	} catch (e) {
		throw new Error("Failed to import OpenAI", { cause: e });
	}

	// Store router metadata if captured
	let routerMetadata: { route?: string; model?: string; provider?: string } = {};
	// Store debug information from litellm security handler
	let debugInfo: {
		originalRequest?: unknown;
		securityResponse?: { action: string; reason?: string; modifiedKwargs?: unknown };
		securityResponseTime?: number;
		llmRequest?: unknown;
		finalLlmResponse?: unknown;
		llmResponseTime?: number;
		totalTime?: number;
		error?: string;
	} = {};

	// Custom fetch wrapper to capture response headers and handle custom JSON responses
	const customFetch = async (url: RequestInfo, init?: RequestInit): Promise<Response> => {
		const response = await fetch(url, init);

		// Capture router headers if present (fallback for non-streaming)
		const routeHeader = response.headers.get("X-Router-Route");
		const modelHeader = response.headers.get("X-Router-Model");
		const providerHeader = response.headers.get("x-inference-provider");

		if (routeHeader && modelHeader) {
			routerMetadata = {
				route: routeHeader,
				model: modelHeader,
				provider: providerHeader || undefined,
			};
		} else if (providerHeader) {
			// Even without router metadata, capture provider info
			routerMetadata = {
				provider: providerHeader,
			};
		}

		// Check if this is a non-streaming response that might contain custom JSON from litellm security handler
		const contentType = response.headers.get("content-type");
		if (contentType?.includes("application/json") && init?.method !== "GET") {
			try {
				const clonedResponse = response.clone();
				const jsonData = await clonedResponse.json();

				// Check if this is a litellm security handler response (has original_request, security_response, etc.)
				if (
					jsonData &&
					typeof jsonData === "object" &&
					("original_request" in jsonData ||
						"security_response" in jsonData ||
						"final_llm_response" in jsonData)
				) {
					debugInfo = {
						originalRequest: jsonData.original_request,
						securityResponse: jsonData.security_response,
						securityResponseTime: jsonData.security_response_time,
						llmRequest: jsonData.llm_request,
						finalLlmResponse: jsonData.final_llm_response,
						llmResponseTime: jsonData.llm_response_time,
						totalTime: jsonData.total_time,
						error: jsonData.error,
					};

					// If there's an error or blocked response, throw an error
					if (jsonData.error) {
						const errorMessage = jsonData.error;
						const securityAction = jsonData.security_response?.action;

						// Map security handler errors to appropriate status codes
						let statusCode = 500;
						if (securityAction === "block") {
							statusCode = 403;
						} else if (errorMessage.includes("missing") || errorMessage.includes("invalid")) {
							statusCode = 400;
						} else if (errorMessage.includes("upstream") || errorMessage.includes("502")) {
							statusCode = 502;
						}

						throw new Error(errorMessage);
					}

					// Extract the actual LLM response from the custom JSON structure
					if (jsonData.final_llm_response) {
						// Create a new Response with the LLM response content
						const llmResponse = jsonData.final_llm_response;
						return new Response(JSON.stringify(llmResponse), {
							status: response.status,
							statusText: response.statusText,
							headers: response.headers,
						});
					}
				}
			} catch (e) {
				// If JSON parsing fails or error extraction fails, continue with original response
				if (e instanceof Error && (e.message.includes("blocked") || e.message.includes("Blocked"))) {
					throw e; // Re-throw security errors
				}
			}
		}

		return response;
	};

	// Build security payload if enabled
	const securityEnabled = serverEnv.SECURITY_ENABLED === "true";
	const securityPayload: Record<string, unknown> = securityEnabled
		? {
				security_params: {
					enabled: true,
					...(serverEnv.SECURITY_API_URL ? { api_url: serverEnv.SECURITY_API_URL } : {}),
					...(serverEnv.SECURITY_API_TOKEN ? { api_token: serverEnv.SECURITY_API_TOKEN } : {}),
				},
			}
		: {};

	const openai = new OpenAI({
		apiKey: apiKey || "sk-",
		baseURL,
		defaultHeaders: {
			...(config.PUBLIC_APP_NAME === "HuggingChat" && { "User-Agent": "huggingchat" }),
			...defaultHeaders,
		},
		defaultQuery,
		fetch: customFetch,
	});

	const imageProcessor = makeImageProcessor(multimodal.image);

	if (completion === "completions") {
		return async ({
			messages,
			preprompt,
			generateSettings,
			conversationId,
			locals,
			abortSignal,
		}) => {
			const prompt = await buildPrompt({
				messages,
				preprompt,
				model,
			});

			const parameters = { ...model.parameters, ...generateSettings };
			const body = {
				model: model.id ?? model.name,
				prompt,
				stream: false, // Force non-streaming for security handler compatibility
				max_tokens: parameters?.max_tokens,
				stop: parameters?.stop,
				temperature: parameters?.temperature,
				top_p: parameters?.top_p,
				frequency_penalty: parameters?.frequency_penalty,
				presence_penalty: parameters?.presence_penalty,
			};

			const openAICompletion = await openai.completions.create(body, {
				body: { ...body, ...extraBody, ...securityPayload },
				headers: {
					"ChatUI-Conversation-ID": conversationId?.toString() ?? "",
					"X-use-cache": "false",
					...(locals?.token ? { Authorization: `Bearer ${locals.token}` } : {}),
				},
				signal: abortSignal,
			});

			return openAICompletionToTextGenerationStream(openAICompletion);
		};
	} else if (completion === "chat_completions") {
		return async ({
			messages,
			preprompt,
			generateSettings,
			conversationId,
			isMultimodal,
			locals,
			abortSignal,
		}) => {
			// Format messages for the chat API, handling multimodal content if supported
			let messagesOpenAI: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
				await prepareMessages(messages, imageProcessor, isMultimodal ?? model.multimodal);

			// Check if a system message already exists as the first message
			const hasSystemMessage = messagesOpenAI.length > 0 && messagesOpenAI[0]?.role === "system";

			if (hasSystemMessage) {
				// System message exists - preserve user configuration
				if (preprompt !== undefined) {
					// Prepend preprompt to existing system message if preprompt exists
					const userSystemPrompt = messagesOpenAI[0].content || "";
					messagesOpenAI[0].content =
						preprompt + (userSystemPrompt ? "\n\n" + userSystemPrompt : "");
				}
				// If no preprompt, user's system message remains unchanged
			} else {
				// No system message exists - create a new one with preprompt or empty string
				messagesOpenAI = [{ role: "system", content: preprompt ?? "" }, ...messagesOpenAI];
			}

			// Combine model defaults with request-specific parameters
			const parameters = { ...model.parameters, ...generateSettings };

			// Force non-streaming mode when security payload is enabled
			// litellm security handler requires non-streaming to return custom JSON responses
			// According to litellm-custom-handler-readme.md: "스트리밍 강제 비활성화: 이 커스텀 JSON 응답 구조를 위해 stream=True 요청을 감지하면 자동으로 stream=False로 변경하여 실행합니다."
			const body: ChatCompletionCreateParamsNonStreaming = {
				model: model.id ?? model.name,
				messages: messagesOpenAI,
				stream: false, // Always use non-streaming when security is enabled, or respect streamingSupported otherwise
				// Support two different ways of specifying token limits depending on the model
				...(useCompletionTokens
					? { max_completion_tokens: parameters?.max_tokens }
					: { max_tokens: parameters?.max_tokens }),
				stop: parameters?.stop,
				temperature: parameters?.temperature,
				top_p: parameters?.top_p,
				frequency_penalty: parameters?.frequency_penalty,
				presence_penalty: parameters?.presence_penalty,
			};

			// Force non-streaming mode for security handler compatibility
			// Always use non-streaming to support custom JSON responses from litellm security handler
			// When security is enabled, litellm handler will return a single JSON object, not a stream
			const openChatAICompletion = await openai.chat.completions.create(
				body,
				{
					body: { ...body, ...extraBody, ...securityPayload, stream: false }, // Always force non-streaming in request body
					headers: {
						"ChatUI-Conversation-ID": conversationId?.toString() ?? "",
						"X-use-cache": "false",
						...(locals?.token ? { Authorization: `Bearer ${locals.token}` } : {}),
					},
					signal: abortSignal,
				}
			);
			return openAIChatToTextGenerationSingle(
				openChatAICompletion,
				() => routerMetadata,
				() => debugInfo
			);
		};
	} else {
		throw new Error("Invalid completion type");
	}
}

async function prepareMessages(
	messages: EndpointMessage[],
	imageProcessor: ReturnType<typeof makeImageProcessor>,
	isMultimodal: boolean
): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[]> {
	return Promise.all(
		messages.map(async (message) => {
			if (message.from === "user" && message.files && message.files.length > 0) {
				const { imageParts, textContent } = await prepareFiles(
					imageProcessor,
					message.files,
					isMultimodal
				);

				// If we have text files, prepend their content to the message
				let messageText = message.content;
				if (textContent.length > 0) {
					messageText = textContent + "\n\n" + message.content;
				}

				// If we have images and multimodal is enabled, use structured content
				if (imageParts.length > 0 && isMultimodal) {
					const parts = [{ type: "text" as const, text: messageText }, ...imageParts];
					return { role: message.from, content: parts };
				}

				// Otherwise just use the text (possibly with injected file content)
				return { role: message.from, content: messageText };
			}
			return { role: message.from, content: message.content };
		})
	);
}

async function prepareFiles(
	imageProcessor: ReturnType<typeof makeImageProcessor>,
	files: MessageFile[],
	isMultimodal: boolean
): Promise<{
	imageParts: OpenAI.Chat.Completions.ChatCompletionContentPartImage[];
	textContent: string;
}> {
	// Separate image and text files
	const imageFiles = files.filter((file) => file.mime.startsWith("image/"));
	const textFiles = files.filter(
		(file) =>
			file.mime.startsWith("text/") ||
			file.mime === "application/json" ||
			file.mime === "application/xml" ||
			file.mime === "application/csv"
	);

	// Process images if multimodal is enabled
	let imageParts: OpenAI.Chat.Completions.ChatCompletionContentPartImage[] = [];
	if (isMultimodal && imageFiles.length > 0) {
		const processedFiles = await Promise.all(imageFiles.map(imageProcessor));
		imageParts = processedFiles.map((file) => ({
			type: "image_url" as const,
			image_url: {
				url: `data:${file.mime};base64,${file.image.toString("base64")}`,
				// Improves compatibility with some OpenAI-compatible servers
				// that expect an explicit detail setting.
				detail: "auto",
			},
		}));
	}

	// Process text files - inject their content
	let textContent = "";
	if (textFiles.length > 0) {
		const textParts = await Promise.all(
			textFiles.map(async (file) => {
				const content = Buffer.from(file.value, "base64").toString("utf-8");
				return `<document name="${file.name}" type="${file.mime}">\n${content}\n</document>`;
			})
		);
		textContent = textParts.join("\n\n");
	}

	return { imageParts, textContent };
}
