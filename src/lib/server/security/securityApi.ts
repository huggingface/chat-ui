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
}> {
	if (!config.enabled || !config.url || !config.apiKey) {
		return { response: null, securityResponseTime: 0 };
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

	if (!enabled || !url || !apiKey) {
		return null;
	}

	return {
		enabled,
		url,
		apiKey,
	};
}

