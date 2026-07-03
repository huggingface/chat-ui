import { browser } from "$app/environment";
import type { Message } from "$lib/types/Message";
import type { DeployedSpace } from "$lib/types/Conversation";

// Payload shape of GET /api/v2/conversations/[id] (post superjson-parse),
// shared by the page load and the create-conversation seed.
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

// One-shot handoff of the conversation payload embedded in the create
// response: POST /conversation seeds it, and the very next load of that
// conversation consumes (and deletes) it, skipping the GET that otherwise
// sits between conversation creation and the first generation request.
//
// Deliberately NOT a cache: an entry lives for the milliseconds between
// goto() and the page load, is read at most once, and every later load of
// the conversation always fetches fresh data. That keeps this immune to the
// staleness classes a real cache has to manage (deletes from other tabs,
// invalidation ordering, session changes).
//
// Browser-only: module state on the server is shared across requests.
const pending = new Map<string, ConversationData>();

// An entry is only orphaned if the goto() after create never happens (e.g.
// navigation error); keep the map bounded anyway.
const MAX_ENTRIES = 2;

export function seedPendingConversation(id: string, data: ConversationData): void {
	if (!browser) return;
	pending.set(id, data);
	if (pending.size > MAX_ENTRIES) {
		const oldest = pending.keys().next().value;
		if (oldest !== undefined) pending.delete(oldest);
	}
}

/** Returns the seeded payload at most once, deleting it on read. */
export function takePendingConversation(id: string): ConversationData | undefined {
	if (!browser) return undefined;
	const data = pending.get(id);
	pending.delete(id);
	return data;
}
