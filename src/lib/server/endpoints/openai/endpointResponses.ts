import { z } from "zod";
import {
	openAIResponsesToTextGenerationSingle,
	openAIResponsesToTextGenerationStream,
} from "./openAIResponsesToTextGenerationStream";
import { config } from "$lib/server/config";
import type { Endpoint } from "../endpoints";
import type OpenAI from "openai";
import { createImageProcessorOptionsValidator, makeImageProcessor } from "../images";
import { prepareMessagesWithFiles } from "$lib/server/textGeneration/utils/prepareFiles";
import type {
	ResponseCreateParamsNonStreaming,
	ResponseCreateParamsStreaming,
	ResponseInputItem,
} from "openai/resources/responses/responses";

export const endpointResponsesParametersSchema = z.object({
	weight: z.number().int().positive().default(1),
	model: z.any(),
	type: z.literal("responses"),
	baseURL: z.string().url().default("https://api.openai.com/v1"),
	apiKey: z.string().default(config.OPENAI_API_KEY || config.HF_TOKEN || "sk-"),
	defaultHeaders: z.record(z.string()).optional(),
	defaultQuery: z.record(z.string()).optional(),
	extraBody: z.record(z.any()).optional(),
	multimodal: z
		.object({
			image: createImageProcessorOptionsValidator({
				supportedMimeTypes: ["image/png", "image/jpeg"],
				preferredMimeType: "image/jpeg",
				maxSizeInMB: 1,
				maxWidth: 1024,
				maxHeight: 1024,
			}),
		})
		.default({}),
	streamingSupported: z.boolean().default(true),
});

/**
 * Convert Chat Completions-style messages (from prepareMessagesWithFiles)
 * to Responses API input format.
 *
 * Returns { input, instructions } where instructions is extracted from
 * system messages.
 */
export function chatMessagesToResponsesInput(
	messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
): { input: ResponseInputItem[]; instructions: string | undefined } {
	const systemParts: string[] = [];
	const input: ResponseInputItem[] = [];

	for (const msg of messages) {
		// Extract system messages into instructions
		if (msg.role === "system") {
			if (typeof msg.content === "string") {
				systemParts.push(msg.content);
			}
			continue;
		}

		// Map content parts for user/assistant messages
		if (typeof msg.content === "string") {
			input.push({
				role: msg.role as "user" | "assistant",
				content: msg.content,
			});
		} else if (Array.isArray(msg.content)) {
			// Convert Chat Completions content parts to Responses API format
			const responseParts: Array<
				| { type: "input_text"; text: string }
				| { type: "input_image"; image_url: string; detail: "auto" | "low" | "high" }
				| { type: "input_file"; file_data: string; filename?: string }
			> = [];

			for (const part of msg.content) {
				if (part.type === "text") {
					responseParts.push({ type: "input_text", text: part.text });
				} else if (part.type === "image_url" && part.image_url) {
					// Chat Completions: { type: "image_url", image_url: { url, detail } }
					// Responses API:    { type: "input_image", image_url, detail }
					const url = typeof part.image_url === "string" ? part.image_url : part.image_url.url;
					const detail =
						typeof part.image_url === "object" && part.image_url.detail
							? (part.image_url.detail as "auto" | "low" | "high")
							: "auto";
					responseParts.push({
						type: "input_image",
						image_url: url,
						detail,
					});
				}
			}

			if (responseParts.length > 0) {
				input.push({
					role: msg.role as "user" | "assistant",
					content: responseParts,
				});
			}
		}
	}

	const instructions = systemParts.length > 0 ? systemParts.join("\n\n") : undefined;
	return { input, instructions };
}

export async function endpointResponses(
	input: z.input<typeof endpointResponsesParametersSchema>
): Promise<Endpoint> {
	const {
		baseURL,
		apiKey,
		model,
		defaultHeaders,
		defaultQuery,
		multimodal,
		extraBody,
		streamingSupported,
	} = endpointResponsesParametersSchema.parse(input);

	let OpenAI;
	try {
		OpenAI = (await import("openai")).OpenAI;
	} catch (e) {
		throw new Error("Failed to import OpenAI", { cause: e });
	}

	// Store router metadata if captured
	let routerMetadata: { route?: string; model?: string; provider?: string } = {};

	// Custom fetch wrapper to capture response headers for router metadata
	const customFetch = async (url: RequestInfo, init?: RequestInit): Promise<Response> => {
		const response = await fetch(url, init);

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
			routerMetadata = { provider: providerHeader };
		}

		return response;
	};

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

	return async ({
		messages,
		preprompt,
		generateSettings,
		conversationId,
		isMultimodal,
		locals,
		abortSignal,
		provider,
	}) => {
		// Prepare messages with file/image handling (reuses existing logic)
		const messagesOpenAI = await prepareMessagesWithFiles(
			messages,
			imageProcessor,
			isMultimodal ?? model.multimodal
		);

		// Handle preprompt: add as system message if not already present
		const normalizedPreprompt = typeof preprompt === "string" ? preprompt.trim() : "";
		let allMessages = messagesOpenAI;

		const hasSystemMessage = allMessages.length > 0 && allMessages[0]?.role === "system";
		if (hasSystemMessage) {
			if (normalizedPreprompt) {
				const userSystemPrompt =
					(typeof allMessages[0].content === "string" ? (allMessages[0].content as string) : "") ||
					"";
				allMessages[0].content =
					normalizedPreprompt + (userSystemPrompt ? "\n\n" + userSystemPrompt : "");
			}
		} else if (normalizedPreprompt) {
			allMessages = [{ role: "system", content: normalizedPreprompt }, ...allMessages];
		}

		// Convert to Responses API format
		const { input: responsesInput, instructions } = chatMessagesToResponsesInput(allMessages);

		const parameters = { ...model.parameters, ...generateSettings };

		// Build model ID with optional provider suffix
		const baseModelId = model.id ?? model.name;
		const modelId = provider && provider !== "auto" ? `${baseModelId}:${provider}` : baseModelId;

		const body = {
			model: modelId,
			input: responsesInput,
			...(instructions ? { instructions } : {}),
			stream: streamingSupported,
			...(parameters?.max_tokens ? { max_output_tokens: parameters.max_tokens } : {}),
			...(parameters?.temperature != null ? { temperature: parameters.temperature } : {}),
			...(parameters?.top_p != null ? { top_p: parameters.top_p } : {}),
		};

		const requestHeaders = {
			"ChatUI-Conversation-ID": conversationId?.toString() ?? "",
			"X-use-cache": "false",
			...(locals?.token ? { Authorization: `Bearer ${locals.token}` } : {}),
			...(locals?.billingOrganization ? { "X-HF-Bill-To": locals.billingOrganization } : {}),
		};

		if (streamingSupported) {
			const stream = await openai.responses.create(
				{ ...body, stream: true } as ResponseCreateParamsStreaming,
				{
					body: { ...body, stream: true, ...extraBody },
					headers: requestHeaders,
					signal: abortSignal,
				}
			);
			return openAIResponsesToTextGenerationStream(stream, () => routerMetadata);
		} else {
			const response = await openai.responses.create(
				{ ...body, stream: false } as ResponseCreateParamsNonStreaming,
				{
					body: { ...body, stream: false, ...extraBody },
					headers: requestHeaders,
					signal: abortSignal,
				}
			);
			return openAIResponsesToTextGenerationSingle(response, () => routerMetadata);
		}
	};
}
