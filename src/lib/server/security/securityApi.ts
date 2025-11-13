import type { EndpointMessage } from "../endpoints/endpoints";
import type OpenAI from "openai";

export interface SecurityApiConfig {
	enabled: boolean;
	url: string;
	apiKey: string;
}

export interface SecurityApiResponse {
	originalRequest?: unknown;
	securityResponse?: {
		action: "allow" | "block" | "modify";
		reason?: string;
		modifiedKwargs?: unknown;
	};
	securityResponseTime?: number;
	llmRequest?: unknown;
	finalLlmResponse?: unknown;
	llmResponseTime?: number;
	totalTime?: number;
	error?: string;
}

/**
 * Call security API with OpenAI Chat Completions format
 * Returns the security API response and timing information
 */
export async function callSecurityApi(
	messages: EndpointMessage[],
	config: SecurityApiConfig,
	abortSignal?: AbortSignal
): Promise<{
	response: OpenAI.Chat.Completions.ChatCompletion | null;
	securityResponseTime: number;
	error?: string;
	isDummy?: boolean;
}> {
	if (!config.enabled) {
		return { response: null, securityResponseTime: 0 };
	}

	// If enabled but URL or API key is missing, return dummy response
	if (!config.url || !config.apiKey) {
		const startTime = Date.now();
		// Simulate API delay
		await new Promise((resolve) => setTimeout(resolve, 100));
		const securityResponseTime = Date.now() - startTime;

		// Convert EndpointMessage[] to OpenAI format for dummy response
		const messagesOpenAI: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = messages.map(
			(msg) => ({
				role: msg.from === "user" ? "user" : msg.from === "assistant" ? "assistant" : "system",
				content: msg.content,
			})
		);

		// Return dummy response in OpenAI ChatCompletion format
		// Security API 더미 응답: Security API URL/Key가 없을 때 반환
		const lastUserMessage = messagesOpenAI[messagesOpenAI.length - 1];
		const originalContent =
			lastUserMessage?.role === "user" && typeof lastUserMessage.content === "string"
				? lastUserMessage.content
				: "";
		const securityDummyContent = originalContent
			? `[Security API 더미 응답] Security API가 설정되지 않아 더미 응답을 반환합니다. 원본 메시지: "${originalContent}"`
			: "[Security API 더미 응답] Security API가 설정되지 않아 더미 응답을 반환합니다.";

		const dummyResponse: OpenAI.Chat.Completions.ChatCompletion = {
			id: "dummy-security-response",
			object: "chat.completion",
			created: Math.floor(Date.now() / 1000),
			model: "gpt-3.5-turbo",
			choices: [
				{
					index: 0,
					message: {
						role: "assistant",
						content: securityDummyContent,
						refusal: null,
					},
					finish_reason: "stop",
					logprobs: null,
				},
			],
			usage: {
				prompt_tokens: 0,
				completion_tokens: 0,
				total_tokens: 0,
			},
		};

		return {
			response: dummyResponse,
			securityResponseTime,
			isDummy: true,
		};
	}

	const startTime = Date.now();

	try {
		// Convert EndpointMessage[] to OpenAI format
		const messagesOpenAI: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = messages.map(
			(msg) => ({
				role: msg.from === "user" ? "user" : msg.from === "assistant" ? "assistant" : "system",
				content: msg.content,
			})
		);

		// Call security API with OpenAI Chat Completions format
		const securityApiUrl = config.url.endsWith("/")
			? `${config.url}chat/completions`
			: `${config.url}/chat/completions`;

		const response = await fetch(securityApiUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${config.apiKey}`,
			},
			body: JSON.stringify({
				model: "gpt-3.5-turbo", // Dummy model for security API
				messages: messagesOpenAI,
				stream: false,
			}),
			signal: abortSignal,
		});

		const securityResponseTime = Date.now() - startTime;

		if (!response.ok) {
			const errorText = await response.text();
			return {
				response: null,
				securityResponseTime,
				error: `Security API error: ${response.status} ${errorText}`,
			};
		}

		const data = (await response.json()) as OpenAI.Chat.Completions.ChatCompletion;

		return {
			response: data,
			securityResponseTime,
		};
	} catch (error) {
		const securityResponseTime = Date.now() - startTime;
		return {
			response: null,
			securityResponseTime,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Merge security API settings from conversation meta and global settings
 * Priority: conversation meta > global settings
 * Returns config even if URL or API key is missing (for dummy mode)
 */
export function mergeSecurityApiConfig(
	conversationMeta?: {
		securityApiEnabled?: boolean;
		securityApiUrl?: string;
		securityApiKey?: string;
	},
	globalSettings?: {
		securityApiEnabled?: boolean;
		securityApiUrl?: string;
		securityApiKey?: string;
	}
): SecurityApiConfig | null {
	const enabled =
		conversationMeta?.securityApiEnabled ?? globalSettings?.securityApiEnabled ?? false;
	const url = conversationMeta?.securityApiUrl ?? globalSettings?.securityApiUrl ?? "";
	const apiKey = conversationMeta?.securityApiKey ?? globalSettings?.securityApiKey ?? "";

	// Return null only if disabled
	if (!enabled) {
		return null;
	}

	// Return config even if URL or API key is missing (for dummy mode)
	return {
		enabled,
		url,
		apiKey,
	};
}
