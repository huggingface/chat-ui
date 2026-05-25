/**
 * Local Conversations Store
 *
 * Stores conversations in IndexedDB on the user's device instead of MongoDB.
 * Enabled only when the operator sets PUBLIC_ENABLE_LOCAL_CONVERSATIONS=true
 * AND the user opts in via the `useLocalConversations` setting.
 *
 * Shape mirrors `Conversation` but `_id` is a string uuid (no MongoDB ObjectId).
 */

import { writable } from "svelte/store";
import { browser } from "$app/environment";
import { env as publicEnv } from "$env/dynamic/public";
import { base } from "$app/paths";
import type { Message } from "$lib/types/Message";

export interface LocalConversation {
	_id: string;
	model: string;
	title: string;
	rootMessageId?: Message["id"];
	messages: Message[];
	preprompt?: string;
	createdAt: Date;
	updatedAt: Date;
}

function toKeyPart(s: string | undefined): string {
	return (s || "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
}

const appLabel = toKeyPart(publicEnv.PUBLIC_APP_ASSETS || publicEnv.PUBLIC_APP_NAME);
const baseLabel = toKeyPart(typeof base === "string" ? base : "");
const DB_NAME = `${appLabel || baseLabel || "app"}:local-conversations`;
const STORE_NAME = "conversations";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
	if (!browser) return Promise.reject(new Error("IndexedDB only available in browser"));
	if (dbPromise) return dbPromise;
	dbPromise = new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME, { keyPath: "_id" });
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
	return dbPromise;
}

async function tx<T>(
	mode: IDBTransactionMode,
	fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const transaction = db.transaction(STORE_NAME, mode);
		const store = transaction.objectStore(STORE_NAME);
		const req = fn(store);
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

/** Reactive store of local conversations, sorted by updatedAt descending. */
export const localConversations = writable<LocalConversation[]>([]);

async function refreshStore() {
	if (!browser) return;
	try {
		const all = await list();
		localConversations.set(all);
	} catch (err) {
		console.error("Failed to load local conversations:", err);
	}
}

export async function list(): Promise<LocalConversation[]> {
	const all = await tx<LocalConversation[]>("readonly", (store) => store.getAll());
	return all.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

export async function get(id: string): Promise<LocalConversation | undefined> {
	const result = await tx<LocalConversation | undefined>("readonly", (store) => store.get(id));
	return result;
}

export async function put(conv: LocalConversation): Promise<void> {
	await tx("readwrite", (store) => store.put(conv));
	await refreshStore();
}

export async function remove(id: string): Promise<void> {
	await tx("readwrite", (store) => store.delete(id));
	await refreshStore();
}

export async function clear(): Promise<void> {
	await tx("readwrite", (store) => store.clear());
	await refreshStore();
}

// Initialize the reactive store on module load (browser only).
if (browser) {
	refreshStore();
}
