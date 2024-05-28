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
	assistant?: Pick<Assistant, "rag" | "dynamicPrompt" | "generateSettings">;
	isContinue: boolean;
	webSearch: boolean;
	toolsPreference: Record<string, boolean>;
	promptedAt: Date;
	ip: string;
	username?: string;
}
