import { browser } from "$app/environment";
import superjson from "superjson";
import type { Message } from "$lib/types/Message";
import type { DeployedSpace } from "$lib/types/Conversation";

// Payload shape of GET /api/v2/conversations/[id] (post superjson-parse),
// shared by the page load, this cache, and the create-conversation seed.
export interface ConversationData {
	messages: Message[];
	title: string;
	model: string;
	preprompt?: string;
	rootMessageId?: string;
	id: string;
	updatedAt: Date;
	modelId: string;
	shared: boolean;
	deployedSpaces?: Record<string, DeployedSpace>;
}

interface CacheEntry {
	data: ConversationData;
	fetchedAt: number;
}

// Browser-only stale-while-revalidate cache of visited conversations, so
// switching back to a recently viewed chat renders instantly instead of
// re-downloading its full history. Must never be populated during SSR: module
// state on the server is shared across requests, i.e. across users.
//
// Correctness contract (enforced by the conversation page load):
// - a load for a DIFFERENT conversation than the previous load is a
//   navigation and may serve this cache (revalidating in the background);
// - a load for the SAME conversation is an explicit invalidate() (stream
//   finished, model switched, generation poller) and must bypass the cache.
const MAX_ENTRIES = 8;

// A cache entry younger than this is served without a background revalidate.
// Covers the two hot paths where a refetch is pure waste: the create-flow
// seed (the entry was just built from the insert we performed) and the
// immediate re-load after a revalidation already replaced the entry.
export const CONVERSATION_CACHE_FRESH_MS = 2_000;

const cache = new Map<string, CacheEntry>();

export function getCachedConversation(id: string): CacheEntry | undefined {
	if (!browser) return undefined;
	const entry = cache.get(id);
	if (!entry) return undefined;
	// Refresh LRU position
	cache.delete(id);
	cache.set(id, entry);
	return entry;
}

export function setCachedConversation(id: string, data: ConversationData): void {
	if (!browser) return;
	cache.delete(id);
	cache.set(id, { data, fetchedAt: Date.now() });
	if (cache.size > MAX_ENTRIES) {
		const oldest = cache.keys().next().value;
		if (oldest !== undefined) cache.delete(oldest);
	}
}

export function invalidateCachedConversation(id: string): void {
	cache.delete(id);
}

/** Stable serialization for change detection between cached and fresh data. */
export function conversationFingerprint(data: ConversationData): string {
	return JSON.stringify(superjson.serialize(data));
}
