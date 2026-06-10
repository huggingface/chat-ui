/**
 * Client-owned conversations sidebar store.
 *
 * SSR safety: this module exports a factory function and context helpers
 * (createConversationsStore / useConversationsStore). The store instance is
 * held inside Svelte component context (keyed by CONVERSATIONS_CONTEXT_KEY)
 * and is therefore per-request on the server and per-layout on the client.
 * There is NO module-level mutable $state, so concurrent SSR requests do not
 * share data.
 *
 * Seeding strategy: +layout.svelte calls init() whenever data.conversations
 * reference changes. The store performs a last-write-wins merge from the
 * server — local optimistic mutations (delete/rename/title) are intentionally
 * overwritten on the next server resync. This is acceptable because:
 *   - delete/rename mutations are immediately visible and the server round-trip
 *     is fast (< 500 ms typical);
 *   - title updates from streaming are ephemeral until the conversation list
 *     is next invalidated, which only happens after generation completes.
 * If we wanted to preserve local mutations across resyncs we would need to
 * track "dirty" ids — the complexity is not justified at this stage.
 */

import { getContext, setContext } from "svelte";
import type { ConvSidebar } from "$lib/types/ConvSidebar";

export const CONVERSATIONS_CONTEXT_KEY = "conversationsStore";

class ConversationsStore {
	#list = $state<ConvSidebar[]>([]);

	get list(): ConvSidebar[] {
		return this.#list;
	}

	/** Replace the entire list (called from layout when data.conversations changes). */
	init(conversations: ConvSidebar[]): void {
		this.#list = conversations;
	}

	/**
	 * Apply a partial patch to a single conversation by id.
	 * Silently ignores unknown ids (e.g. race between title update and delete).
	 */
	update(id: string, patch: Partial<Omit<ConvSidebar, "id">>): void {
		const idx = this.#list.findIndex((c) => String(c.id) === id);
		if (idx === -1) return;
		this.#list[idx] = { ...this.#list[idx], ...patch };
	}

	/** Remove a conversation by id (optimistic delete). */
	remove(id: string): void {
		this.#list = this.#list.filter((c) => String(c.id) !== id);
	}

	/** Prepend a new conversation to the top of the list. */
	prepend(conv: ConvSidebar): void {
		this.#list = [conv, ...this.#list];
	}
}

/** Call once in +layout.svelte to create and register the store in context. */
export function createConversationsStore(): ConversationsStore {
	const store = new ConversationsStore();
	setContext(CONVERSATIONS_CONTEXT_KEY, store);
	return store;
}

/** Call in any descendant component to access the store. */
export function useConversationsStore(): ConversationsStore {
	return getContext<ConversationsStore>(CONVERSATIONS_CONTEXT_KEY);
}
