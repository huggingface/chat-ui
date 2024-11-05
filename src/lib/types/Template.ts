import type { Message } from "./Message";

export type ChatTemplateInput = {
	messages: Pick<Message, "from" | "content">[];
	preprompt?: string;
};
