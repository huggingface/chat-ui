import { storage } from "./indexedDB";
import type { Conversation } from "$lib/types/Conversation";
import type { StoredConversation } from "./types";
import { CONV_NUM_PER_PAGE } from "$lib/constants/pagination";

export async function getConversations(page: number = 0): Promise<
	Array<{
		id: string;
		title: string;
		updatedAt: Date;
		model: string;
		modelId: string;
	}>
> {
	const conversations = await storage.getConversations();
	const start = page * CONV_NUM_PER_PAGE;
	const end = start + CONV_NUM_PER_PAGE;
	const pageConversations = conversations.slice(start, end);

	return pageConversations.map((conv) => ({
		id: conv.id,
		title: conv.title,
		updatedAt: conv.updatedAt,
		model: conv.model,
		modelId: conv.model,
	}));
}

export async function getConversation(id: string): Promise<StoredConversation | null> {
	const conv = await storage.getConversation(id);
	if (!conv) {
		return null;
	}

	return conv;
}

export async function saveConversation(conversation: StoredConversation | Omit<StoredConversation, "createdAt" | "updatedAt">): Promise<StoredConversation> {
	return await storage.saveConversation(conversation);
}

export async function deleteConversation(id: string): Promise<void> {
	await storage.deleteConversation(id);
}

export async function deleteAllConversations(): Promise<void> {
	await storage.deleteAllConversations();
}

