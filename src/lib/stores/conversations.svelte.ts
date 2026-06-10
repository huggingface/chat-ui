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
 * Browser singleton: in addition to the context-based facade, a module-level
 * _browserSingleton reference is set the first time createConversationsStore()
 * runs in the browser. This allows non-component modules (e.g. settings.ts)
 * that cannot call getContext() to call refreshConversationsStore() without
 * going through the SvelteKit invalidation bus.  The singleton is guarded by
 * `browser` from $app/environment and is always undefined on the server, so
 * it is SSR-safe.
 *
 * Seeding strategy: +layout.svelte calls init() whenever data.conversations
 * reference changes. The store performs a last-write-wins merge from the
 * server — local optimistic mutations (delete/rename/title) are intentionally
 * overwritten on the next server resync. This is acceptable because:
 *   - delete/rename mutations are immediately visible and the server round-trip
 *     is fast (< 500 ms typical);
 *   - title updates from streaming are ephemeral until the store is next
 *     refreshed, which happens after generation completes.
 * If we wanted to preserve local mutations across resyncs we would need to
 * track "dirty" ids — the complexity is not justified at this stage.
 */

import { browser } from "$app/environment";
import { getContext, setContext } from "svelte";
import type { ConvSidebar } from "$lib/types/ConvSidebar";
import { useAPIClient, handleResponse } from "$lib/APIClient";

export const CONVERSATIONS_CONTEXT_KEY = "conversationsStore";

/**
 * Module-level browser-only singleton. Set once in createConversationsStore()
 * when running in the browser. Always undefined on the server.
 * Allows non-component modules (settings.ts) to call refreshConversationsStore()
 * without getContext().
 */
let _browserSingleton: ConversationsStore | undefined;

interface ConversationListItem {
	_id: { toString(): string };
	title: string;
	updatedAt: Date | string;
	model?: string;
}

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

	/**
	 * Re-fetch GET /api/v2/conversations?p=0 and reconcile with the local list.
	 * Performs a last-write-wins replace so updatedAt ordering reflects the server.
	 * No-op on the server (browser guard).
	 */
	async refresh(): Promise<void> {
		if (!browser) return;
		try {
			const client = useAPIClient();
			const data = (await client.conversations.get({ query: { p: 0 } }).then(handleResponse)) as {
				conversations: ConversationListItem[];
				hasMore: boolean;
			};

			const defaultModel = undefined; // caller can patch model separately if needed
			const freshList: ConvSidebar[] = data.conversations.map((conv) => ({
				id: conv._id.toString(),
				title: conv.title.trim(),
				model: conv.model ?? defaultModel,
				updatedAt: new Date(conv.updatedAt),
			}));
			this.#list = freshList;
		} catch (err) {
			// Non-fatal: keep the existing list rather than blanking the sidebar.
			console.error("[conversationsStore] refresh failed", err);
		}
	}
}

/** Call once in +layout.svelte to create and register the store in context. */
export function createConversationsStore(): ConversationsStore {
	const store = new ConversationsStore();
	setContext(CONVERSATIONS_CONTEXT_KEY, store);
	// Register the browser singleton so non-component modules can call refresh().
	if (browser) {
		_browserSingleton = store;
	}
	return store;
}

/** Call in any descendant component to access the store. */
export function useConversationsStore(): ConversationsStore {
	return getContext<ConversationsStore>(CONVERSATIONS_CONTEXT_KEY);
}

/**
 * Refresh the conversations sidebar without going through the SvelteKit
 * invalidation bus.  Safe to call from non-component modules (e.g. settings.ts)
 * that cannot use getContext().  No-op on the server.
 */
export function refreshConversationsStore(): Promise<void> {
	if (!browser || !_browserSingleton) return Promise.resolve();
	return _browserSingleton.refresh();
}
