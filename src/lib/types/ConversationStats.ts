import type { Timestamps } from "./Timestamps";

export interface ConversationStats extends Timestamps {
	date: {
		day: Date;
		field: "updatedAt" | "createdAt";
	};
	distinct: "sessionId" | "userId" | "userOrSessionId" | "_id";
	count: number;
}
