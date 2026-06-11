// Ideally shouldn't be needed, see https://github.com/huggingface/chat-ui/pull/88#issuecomment-1523173850

import type { Conversation } from "./Conversation";
import type { Timestamps } from "./Timestamps";

export interface AbortedGeneration extends Timestamps {
	conversationId: Conversation["_id"];
	// Stop point reported by the stopping client: which generation it was
	// watching and how many characters of the streamed message it had on
	// screen when Stop was clicked. Lets the generating pod clamp the
	// persisted text to what the user saw rather than everything emitted
	// before the marker was observed. Absent for legacy stop requests.
	generationId?: string;
	seenContentLength?: number;
}
