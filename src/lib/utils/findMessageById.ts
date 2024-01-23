import type { Conversation } from "$lib/types/Conversation";
import type { Message } from "$lib/types/Message";

export function findMessageById(id: string, conv: Conversation): Message | undefined {
	return conv.messages.find((message) => message.id === id);
}

// export function updateMessageById(id: string, conv: Conversation, update: Optional<Message>): Conversation {

//     );
