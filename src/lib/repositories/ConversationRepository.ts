/**
 * Client-side repository for IndexedDB-backed persistence of conversations.
 *
 * Maintains two object stores:
 *   - `conversations`        — sidebar list (ConvSidebar items)
 *   - `conversation_details` — full message history (Conversation-like payloads)
 *
 * Consistency model: **server always wins**. Data returned from the server
 * always overwrites local cache entries. Only fully-acknowledged messages
 * (confirmed by the server) are persisted; optimistic/transient state lives
 * exclusively in the UI stores.
 */

import { browser } from "$app/environment";
import type { ConvSidebar } from "$lib/types/ConvSidebar";

const DB_NAME = "chat-ui-cache";
const DB_VERSION = 1;

/** Lightweight serialisable shape for the sidebar list (mirrors ConvSidebar). */
export interface StoredConversation {
	id: string;
	title: string;
	updatedAt: string; // ISO string (Dates serialised for structured clone safety)
	model?: string;
}

/** Lightweight serialisable shape for a full conversation payload. */
export interface StoredConversationDetail {
	id: string;
	title: string;
	model: string;
	updatedAt: string; // ISO string
	messages: string; // JSON-stringified Message[] (preserves Date etc. via superjson)
	preprompt?: string;
	rootMessageId?: string;
	shared: boolean;
	modelId: string;
}

function openDB(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains("conversations")) {
				db.createObjectStore("conversations", { keyPath: "id" });
			}
			if (!db.objectStoreNames.contains("conversation_details")) {
				db.createObjectStore("conversation_details", { keyPath: "id" });
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

function getStore(db: IDBDatabase, storeName: string, mode: IDBTransactionMode): IDBObjectStore {
	const tx = db.transaction(storeName, mode);
	return tx.objectStore(storeName);
}

function promisifyRequest<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

export class ConversationRepository {
	private dbPromise: Promise<IDBDatabase> | null = null;

	private async ensureDB(): Promise<IDBDatabase> {
		if (!this.dbPromise) {
			this.dbPromise = openDB();
		}
		return this.dbPromise;
	}

	// ---------------------------------------------------------------------------
	// Conversations (sidebar list)
	// ---------------------------------------------------------------------------

	/** Replace the entire sidebar list in one transaction. */
	async setConversations(items: ConvSidebar[]): Promise<void> {
		if (!browser) return;
		const db = await this.ensureDB();
		const store = getStore(db, "conversations", "readwrite");
		// Clear and re-insert for a full replace
		await promisifyRequest(store.clear());
		for (const item of items) {
			store.put(this.toStoredConversation(item));
		}
	}

	/** Return all cached sidebar conversations, newest first. */
	async getConversations(): Promise<ConvSidebar[]> {
		if (!browser) return [];
		const db = await this.ensureDB();
		const store = getStore(db, "conversations", "readonly");
		const all = await promisifyRequest(store.getAll());
		return (all ?? [])
			.map((s) => this.fromStoredConversation(s))
			.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
	}

	// ---------------------------------------------------------------------------
	// Conversation details (full message history)
	// ---------------------------------------------------------------------------

	/** Store (overwrite) a full conversation detail. */
	async setConversationDetail(
		id: string,
		detail: Omit<StoredConversationDetail, "id">
	): Promise<void> {
		if (!browser) return;
		const db = await this.ensureDB();
		const store = getStore(db, "conversation_details", "readwrite");
		await promisifyRequest(store.put({ id, ...detail }));
	}

	/** Retrieve a full conversation detail by id. */
	async getConversationDetail(id: string): Promise<StoredConversationDetail | undefined> {
		if (!browser) return undefined;
		const db = await this.ensureDB();
		const store = getStore(db, "conversation_details", "readonly");
		return promisifyRequest(store.get(id));
	}

	/** Remove a conversation detail by id. */
	async removeConversationDetail(id: string): Promise<void> {
		if (!browser) return;
		const db = await this.ensureDB();
		const store = getStore(db, "conversation_details", "readwrite");
		await promisifyRequest(store.delete(id));
	}

	// ---------------------------------------------------------------------------
	// Bulk operations
	// ---------------------------------------------------------------------------

	/** Clear all cached data (called on logout). */
	async clearAll(): Promise<void> {
		if (!browser) return;
		const db = await this.ensureDB();
		const tx = db.transaction(["conversations", "conversation_details"], "readwrite");
		tx.objectStore("conversations").clear();
		tx.objectStore("conversation_details").clear();
		return new Promise((resolve, reject) => {
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
	}

	// ---------------------------------------------------------------------------
	// Serialisation helpers
	// ---------------------------------------------------------------------------

	private toStoredConversation(item: ConvSidebar): StoredConversation {
		return {
			id: String(item.id),
			title: item.title,
			updatedAt: item.updatedAt.toISOString(),
			model: item.model,
		};
	}

	private fromStoredConversation(s: StoredConversation): ConvSidebar {
		return {
			id: s.id,
			title: s.title,
			updatedAt: new Date(s.updatedAt),
			model: s.model,
		};
	}
}

/** Singleton instance — the single source of truth for IndexedDB access. */
export const conversationRepository = new ConversationRepository();
