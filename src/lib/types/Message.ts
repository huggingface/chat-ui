export interface Message {
	from: "user" | "assistant";
	id: ReturnType<typeof crypto.randomUUID>;
	content: string;
	score?: -1 | 0 | 1;
}
