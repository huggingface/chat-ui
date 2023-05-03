export interface Message {
	from: "user" | "assistant";
	id: ReturnType<typeof crypto.randomUUID>;
	content: string;
	// Only for "assistant" messages
	model?: string;
}
