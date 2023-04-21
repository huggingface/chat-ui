import type { Conversation } from "$lib/types/Conversation";
import { collections } from "./database";

export function listConversations(
	sessionId: string
): Promise<{ title: Conversation["title"]; id: string }[]> {
	return collections.conversations
		.find({
			sessionId: sessionId,
		})
		.sort({ updatedAt: -1 })
		.project<Pick<Conversation, "title" | "_id" | "updatedAt" | "createdAt">>({
			title: 1,
			_id: 1,
			updatedAt: 1,
			createdAt: 1,
		})
		.map((conv) => ({ id: conv._id.toString(), title: conv.title }))
		.toArray();
}
