import type { CreateIndexesOptions, IndexSpecification } from "mongodb";

/** entries only matter while a turn checks the space */
export const SPACE_CONSOLE_TTL_SECONDS = 30 * 60;

type Index = { label: string; keys: IndexSpecification; options: CreateIndexesOptions };

/** shared with the specs, which need the unique key before initDatabase builds it */
export const SPACE_CONSOLE_INDEXES: { entries: Index[]; frames: Index[] } = {
	entries: [
		{
			label: "session and seq",
			keys: { conversationId: 1, spaceId: 1, sessionId: 1, seq: 1 },
			options: { unique: true },
		},
		{
			label: "createdAt (TTL)",
			keys: { createdAt: 1 },
			options: { expireAfterSeconds: SPACE_CONSOLE_TTL_SECONDS },
		},
	],
	frames: [
		{
			label: "conversation and Space",
			keys: { conversationId: 1, spaceId: 1 },
			options: { unique: true },
		},
		{
			label: "updatedAt (TTL)",
			keys: { updatedAt: 1 },
			options: { expireAfterSeconds: SPACE_CONSOLE_TTL_SECONDS },
		},
	],
};
