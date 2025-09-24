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
	isContinue: boolean;
	promptedAt: Date;
	ip: string;
	username?: string;
	/** Force-enable multimodal handling for endpoints that support it */
	forceMultimodal?: boolean;
}
