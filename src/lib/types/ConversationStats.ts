import type { Timestamps } from "./Timestamps";

export interface ConversationStats extends Timestamps {
	date: {
		at: Date;
		span: "day" | "weak" | "month";
		field: "updatedAt" | "createdAt";
	};
	type: "conversation" | "message";
	/**  _id => conversationId, eg for type="message" messages will be grouped by conversation */
	distinct: "sessionId" | "userId" | "userOrSessionId" | "_id";
	count: number;
}
