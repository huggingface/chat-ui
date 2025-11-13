// Ideally shouldn't be needed, see https://github.com/huggingface/chat-ui/pull/88#issuecomment-1523173850

import type { Timestamps } from "./Timestamps";

export interface AbortedGeneration extends Timestamps {
	conversationId: string;
}
