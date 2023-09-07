import type { Timestamps } from "./Timestamps";

export type Message = Partial<Timestamps> & {
	from: "user" | "assistant";
	id: ReturnType<typeof crypto.randomUUID>;
	content: string;
	webSearchId?: string;
	score?: -1 | 0 | 1;
};
