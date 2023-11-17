import type { MessageUpdate } from "./MessageUpdate";
import type { Timestamps } from "./Timestamps";
import type { WebSearch } from "./WebSearch";

export type Message = Partial<Timestamps> & {
	from: "user" | "assistant" | "function" | "system" | "agent" | "webSearch" | "database";
	id: ReturnType<typeof crypto.randomUUID>;
	content: string;
	updates?: MessageUpdate[];
	webSearchId?: WebSearch["_id"]; // legacy version
	webSearch?: WebSearch;
	score?: -1 | 0 | 1;
};
