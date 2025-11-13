import type { StoredConversation, StoredFile, StoredSettings } from "./types";
import type { Conversation } from "$lib/types/Conversation";
import type { Settings } from "$lib/types/Settings";
import { nanoid } from "nanoid";
import { browser } from "$app/environment";

const DB_NAME = "chat-ui";
const DB_VERSION = 1;

const STORES = {
	CONVERSATIONS: "conversations",
	FILES: "files",
	SETTINGS: "settings",
} as const;

class IndexedDBStorage {
	private db: IDBDatabase | null = null;
	private initPromise: Promise<void> | null = null;

	private async init(): Promise<void> {
		if (!browser) {
			throw new Error("IndexedDB is only available in the browser");
		}

		if (this.db) {
			return;
		}

		if (this.initPromise) {
			return this.initPromise;
		}

		this.initPromise = new Promise((resolve, reject) => {
			if (typeof indexedDB === "undefined") {
				reject(new Error("IndexedDB is not supported in this browser"));
				return;
			}

			const request = indexedDB.open(DB_NAME, DB_VERSION);

			request.onerror = () => {
				reject(new Error("Failed to open IndexedDB"));
			};

			request.onsuccess = () => {
				this.db = request.result;
				resolve();
			};

			request.onupgradeneeded = (event) => {
				const db = (event.target as IDBOpenDBRequest).result;

				// Conversations store
				if (!db.objectStoreNames.contains(STORES.CONVERSATIONS)) {
					const conversationsStore = db.createObjectStore(STORES.CONVERSATIONS, {
						keyPath: "id",
					});
					conversationsStore.createIndex("updatedAt", "updatedAt", { unique: false });
					conversationsStore.createIndex("createdAt", "createdAt", { unique: false });
				}

				// Files store
				if (!db.objectStoreNames.contains(STORES.FILES)) {
					const filesStore = db.createObjectStore(STORES.FILES, {
						keyPath: "id",
					});
					filesStore.createIndex("conversationId", "conversationId", { unique: false });
					filesStore.createIndex("hash", "hash", { unique: false });
				}

				// Settings store
				if (!db.objectStoreNames.contains(STORES.SETTINGS)) {
					db.createObjectStore(STORES.SETTINGS, {
						keyPath: "id",
					});
				}
			};
		});

		return this.initPromise;
	}

	// Conversations
	async getConversations(): Promise<StoredConversation[]> {
		await this.init();
		return new Promise((resolve, reject) => {
			if (!this.db) {
				reject(new Error("Database not initialized"));
				return;
			}

			// Deserialize ISO strings back to Date objects
			const deserializeDates = (obj: unknown): unknown => {
				if (typeof obj === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(obj)) {
					// Check if it's an ISO date string
					const date = new Date(obj);
					if (!isNaN(date.getTime())) {
						return date;
					}
				}
				if (Array.isArray(obj)) {
					return obj.map(deserializeDates);
				}
				if (obj && typeof obj === "object") {
					return Object.fromEntries(
						Object.entries(obj).map(([key, value]) => [key, deserializeDates(value)])
					);
				}
				return obj;
			};

			const transaction = this.db.transaction([STORES.CONVERSATIONS], "readonly");
			const store = transaction.objectStore(STORES.CONVERSATIONS);
			const index = store.index("updatedAt");
			const request = index.getAll();

			request.onsuccess = () => {
				const conversations = (deserializeDates(request.result) as StoredConversation[]) || [];
				// Sort by updatedAt descending
				conversations.sort((a, b) => {
					const aTime = a.updatedAt instanceof Date ? a.updatedAt.getTime() : new Date(a.updatedAt as string).getTime();
					const bTime = b.updatedAt instanceof Date ? b.updatedAt.getTime() : new Date(b.updatedAt as string).getTime();
					return bTime - aTime;
				});
				resolve(conversations);
			};

			request.onerror = () => {
				reject(new Error("Failed to get conversations"));
			};
		});
	}

	async getConversation(id: string): Promise<StoredConversation | null> {
		await this.init();
		return new Promise((resolve, reject) => {
			if (!this.db) {
				reject(new Error("Database not initialized"));
				return;
			}

			// Deserialize ISO strings back to Date objects
			const deserializeDates = (obj: unknown): unknown => {
				if (typeof obj === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(obj)) {
					// Check if it's an ISO date string
					const date = new Date(obj);
					if (!isNaN(date.getTime())) {
						return date;
					}
				}
				if (Array.isArray(obj)) {
					return obj.map(deserializeDates);
				}
				if (obj && typeof obj === "object") {
					return Object.fromEntries(
						Object.entries(obj).map(([key, value]) => [key, deserializeDates(value)])
					);
				}
				return obj;
			};

			const transaction = this.db.transaction([STORES.CONVERSATIONS], "readonly");
			const store = transaction.objectStore(STORES.CONVERSATIONS);
			const request = store.get(id);

			request.onsuccess = () => {
				const result = request.result;
				if (!result) {
					resolve(null);
					return;
				}
				const deserialized = deserializeDates(result) as StoredConversation;
				resolve(deserialized);
			};

			request.onerror = () => {
				reject(new Error("Failed to get conversation"));
			};
		});
	}

	async saveConversation(conversation: StoredConversation | Omit<StoredConversation, "createdAt" | "updatedAt">): Promise<StoredConversation> {
		await this.init();
		return new Promise((resolve, reject) => {
			if (!this.db) {
				reject(new Error("Database not initialized"));
				return;
			}

			const now = new Date();
			// Serialize Date objects to ISO strings for IndexedDB storage
			const serializeDates = (obj: unknown): unknown => {
				if (obj instanceof Date) {
					return obj.toISOString();
				}
				if (Array.isArray(obj)) {
					return obj.map(serializeDates);
				}
				if (obj && typeof obj === "object") {
					return Object.fromEntries(
						Object.entries(obj).map(([key, value]) => [key, serializeDates(value)])
					);
				}
				return obj;
			};

			const stored: StoredConversation = {
				...conversation,
				id: conversation.id || nanoid(),
				updatedAt: now,
				createdAt: (conversation as StoredConversation).createdAt || now,
			};

			// Serialize the conversation for storage
			const serialized = serializeDates(stored) as StoredConversation;

			const transaction = this.db.transaction([STORES.CONVERSATIONS], "readwrite");
			const store = transaction.objectStore(STORES.CONVERSATIONS);
			const request = store.put(serialized);

			request.onsuccess = () => {
				resolve(stored);
			};

			request.onerror = () => {
				reject(new Error(`Failed to save conversation: ${request.error?.message || "Unknown error"}`));
			};
		});
	}

	async deleteConversation(id: string): Promise<void> {
		await this.init();
		return new Promise((resolve, reject) => {
			if (!this.db) {
				reject(new Error("Database not initialized"));
				return;
			}

			const transaction = this.db.transaction([STORES.CONVERSATIONS], "readwrite");
			const store = transaction.objectStore(STORES.CONVERSATIONS);
			const request = store.delete(id);

			request.onsuccess = () => {
				resolve();
			};

			request.onerror = () => {
				reject(new Error("Failed to delete conversation"));
			};
		});
	}

	async deleteAllConversations(): Promise<void> {
		await this.init();
		return new Promise((resolve, reject) => {
			if (!this.db) {
				reject(new Error("Database not initialized"));
				return;
			}

			const transaction = this.db.transaction([STORES.CONVERSATIONS], "readwrite");
			const store = transaction.objectStore(STORES.CONVERSATIONS);
			const request = store.clear();

			request.onsuccess = () => {
				resolve();
			};

			request.onerror = () => {
				reject(new Error("Failed to delete all conversations"));
			};
		});
	}

	// Files
	async saveFile(file: File, conversationId: string, hash: string): Promise<StoredFile> {
		await this.init();
		return new Promise((resolve, reject) => {
			if (!this.db) {
				reject(new Error("Database not initialized"));
				return;
			}

			const stored: StoredFile = {
				id: nanoid(),
				conversationId,
				hash,
				data: file,
				mime: file.type,
				name: file.name,
				createdAt: new Date(),
			};

			const transaction = this.db.transaction([STORES.FILES], "readwrite");
			const store = transaction.objectStore(STORES.FILES);
			const request = store.put(stored);

			request.onsuccess = () => {
				resolve(stored);
			};

			request.onerror = () => {
				reject(new Error("Failed to save file"));
			};
		});
	}

	async getFile(hash: string, conversationId: string): Promise<StoredFile | null> {
		await this.init();
		return new Promise((resolve, reject) => {
			if (!this.db) {
				reject(new Error("Database not initialized"));
				return;
			}

			const transaction = this.db.transaction([STORES.FILES], "readonly");
			const store = transaction.objectStore(STORES.FILES);
			const index = store.index("hash");
			const request = index.getAll(hash);

			request.onsuccess = () => {
				const files = request.result as StoredFile[];
				const file = files.find((f) => f.conversationId === conversationId) || files[0] || null;
				resolve(file);
			};

			request.onerror = () => {
				reject(new Error("Failed to get file"));
			};
		});
	}

	async getFilesByConversation(conversationId: string): Promise<StoredFile[]> {
		await this.init();
		return new Promise((resolve, reject) => {
			if (!this.db) {
				reject(new Error("Database not initialized"));
				return;
			}

			const transaction = this.db.transaction([STORES.FILES], "readonly");
			const store = transaction.objectStore(STORES.FILES);
			const index = store.index("conversationId");
			const request = index.getAll(conversationId);

			request.onsuccess = () => {
				resolve(request.result as StoredFile[]);
			};

			request.onerror = () => {
				reject(new Error("Failed to get files"));
			};
		});
	}

	// Settings
	async getSettings(): Promise<StoredSettings | null> {
		await this.init();
		return new Promise((resolve, reject) => {
			if (!this.db) {
				reject(new Error("Database not initialized"));
				return;
			}

			const transaction = this.db.transaction([STORES.SETTINGS], "readonly");
			const store = transaction.objectStore(STORES.SETTINGS);
			const request = store.get("current-settings");

			request.onsuccess = () => {
				resolve((request.result as StoredSettings) || null);
			};

			request.onerror = () => {
				reject(new Error("Failed to get settings"));
			};
		});
	}

	async saveSettings(settings: Settings | StoredSettings): Promise<StoredSettings> {
		await this.init();
		return new Promise((resolve, reject) => {
			if (!this.db) {
				reject(new Error("Database not initialized"));
				return;
			}

			const stored: StoredSettings = {
				...(settings as StoredSettings),
				id: (settings as StoredSettings).id || "current-settings",
				updatedAt: new Date(),
				createdAt: (settings as StoredSettings).createdAt || new Date(),
			};

			const transaction = this.db.transaction([STORES.SETTINGS], "readwrite");
			const store = transaction.objectStore(STORES.SETTINGS);
			const request = store.put(stored);

			request.onsuccess = () => {
				resolve(stored);
			};

			request.onerror = () => {
				reject(new Error("Failed to save settings"));
			};
		});
	}
}

export const storage = new IndexedDBStorage();

