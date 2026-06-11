/**
 * Client-only store for File objects that cannot be serialized into
 * SvelteKit's history state (which must be JSON-serializable).
 *
 * Callers generate a random nonce, store their File[] here under that nonce,
 * then pass the nonce alongside the text via goto() history state.  The
 * destination page consumes and removes the entry so it is never leaked.
 *
 * SSR-safe: the Map is only created in browser environments.  On the server
 * the module exports a no-op API so imports never crash during SSR.
 */

import { browser } from "$app/environment";

const store: Map<string, File[]> = browser ? new Map() : (null as unknown as Map<string, File[]>);

/** Save files under a nonce and return the nonce. */
export function storePendingFiles(files: File[]): string {
	const nonce = crypto.randomUUID();
	if (browser) {
		store.set(nonce, files);
	}
	return nonce;
}

/** Consume (retrieve and delete) files for a given nonce. Returns [] on miss. */
export function consumePendingFiles(nonce: string): File[] {
	if (!browser) return [];
	const files = store.get(nonce) ?? [];
	store.delete(nonce);
	return files;
}
