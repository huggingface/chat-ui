import type { Message } from "./Message";
import type { Timestamps } from "./Timestamps";
import type { Assistant } from "./Assistant";

export interface Conversation extends Timestamps {
	id: string;

	model: string;

	title: string;
	rootMessageId?: Message["id"];
	messages: Message[];

	meta?: {
		fromShareId?: string;
		// Conversation-specific API settings (override global settings)
		securityApiEnabled?: boolean;
		securityApiUrl?: string;
		securityApiKey?: string;
		llmApiUrl?: string;
		llmApiKey?: string;
	};

	preprompt?: string;
	assistantId?: Assistant["_id"];

	userAgent?: string;
}
