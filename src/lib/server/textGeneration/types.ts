import type { ProcessedModel } from "../models";
import type { Endpoint } from "../endpoints/endpoints";
import type { Conversation } from "$lib/types/Conversation";
import type { Message } from "$lib/types/Message";
import type { Assistant } from "$lib/types/Assistant";

export interface TextGenerationContext {
	model: ProcessedModel;
	endpoint: Endpoint;
	conv: Conversation;
	messages: Message[];
	assistant?: Pick<Assistant, "dynamicPrompt" | "generateSettings">;
	promptedAt: Date;
	ip: string;
	username?: string;
	/** Force-enable multimodal handling for endpoints that support it */
	forceMultimodal?: boolean;
	/** Force-enable tool calling even if model does not advertise support */
	forceTools?: boolean;
	/** Inference provider preference: "auto", "fastest", "cheapest", or a specific provider name */
	provider?: string;
	/** Optional thinking-effort override forwarded as `reasoning_effort` to OpenAI-compatible endpoints */
	reasoningEffort?: "low" | "medium" | "high";
	/** Per-model user override for reasoning; wins over the model's supportsReasoning flag in both directions */
	reasoningOverride?: boolean;
	/** Per-model user override for artifacts; wins over the model's supportsArtifacts flag in both directions */
	artifactsOverride?: boolean;
	locals: App.Locals | undefined;
	abortController: AbortController;
	/** Also identifies the audience for an MCP elicitation raised mid tool call. */
	generationId?: string;
	/** The assistant message this run writes into; a durable prompt resumes against it. */
	messageId?: string;
}
