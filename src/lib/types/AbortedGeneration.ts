// Ideally shouldn't be needed, see https://github.com/huggingface/chat-ui/pull/88#issuecomment-1523173850

import type { Conversation } from "./Conversation";

export interface AbortedGeneration {
	createdAt: Date;
	updatedAt: Date;
	conversationId: Conversation["_id"];
}
