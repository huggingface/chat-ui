/**
 * Which conversations have a generation running right now, kept separate from the
 * sidebar store on purpose: that store does a last-write-wins full replace on every
 * conversation invalidation, which would wipe a generating flag stored on the row.
 * Holding this state alongside it — not on it — sidesteps that entirely.
 *
 * SSR-safe like conversations.svelte.ts: a factory plus context helpers, no
 * module-level mutable state. Populated only in the browser by the live watcher.
 */

import { getContext, setContext } from "svelte";
import { SvelteSet } from "svelte/reactivity";
import type { ObjectId } from "mongodb";

export const ACTIVE_GENERATIONS_CONTEXT_KEY = "activeGenerationsStore";

class ActiveGenerationsStore {
	#ids = new SvelteSet<string>();

	has(conversationId: string | ObjectId): boolean {
		return this.#ids.has(String(conversationId));
	}

	/** Replace the running set with the latest snapshot from the server. */
	setRunning(conversationIds: string[]): void {
		const next = new Set(conversationIds.map(String));
		if (next.size === this.#ids.size && [...next].every((id) => this.#ids.has(id))) return;
		this.#ids.clear();
		for (const id of next) this.#ids.add(id);
	}
}

export function createActiveGenerationsStore(): ActiveGenerationsStore {
	const store = new ActiveGenerationsStore();
	setContext(ACTIVE_GENERATIONS_CONTEXT_KEY, store);
	return store;
}

export function useActiveGenerationsStore(): ActiveGenerationsStore {
	return getContext<ActiveGenerationsStore>(ACTIVE_GENERATIONS_CONTEXT_KEY);
}
