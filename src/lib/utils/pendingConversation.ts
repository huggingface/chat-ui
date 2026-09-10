import { browser } from "$app/environment";
import superjson from "superjson";
import type { Message } from "$lib/types/Message";
import type { DeployedSpace, MlBudget } from "$lib/types/Conversation";
import type { PlanState } from "$lib/types/Plan";
import type { TurnStateSnapshot } from "$lib/types/TurnState";

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
	mlAssistant?: boolean;
	mlBudget?: MlBudget;
	plan?: PlanState;
	turnState?: TurnStateSnapshot;
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

/**
 * Decodes and seeds the conversation embedded in POST /conversation.
 * Returning the decoded payload lets the caller use the server-persisted mode
 * as the source of truth for UI state and optimistic sidebar metadata.
 */
export function seedCreatedConversation(
	id: string,
	serialized: unknown
): ConversationData | undefined {
	if (typeof serialized !== "string") return undefined;
	try {
		const data = superjson.parse<ConversationData>(serialized);
		if (!data || data.id !== id || !Array.isArray(data.messages)) return undefined;
		seedPendingConversation(id, data);
		return data;
	} catch {
		// Malformed seed: the page load falls back to a normal fetch.
		return undefined;
	}
}

/** Returns the seeded payload at most once, deleting it on read. */
export function takePendingConversation(id: string): ConversationData | undefined {
	if (!browser) return undefined;
	const data = pending.get(id);
	pending.delete(id);
	return data;
}
