// MongoDB has been removed - this file provides stub collections for backward compatibility
// All data is now stored client-side in IndexedDB

import { building } from "$app/environment";
import type { Conversation } from "$lib/types/Conversation";
import type { SharedConversation } from "$lib/types/SharedConversation";
import type { AbortedGeneration } from "$lib/types/AbortedGeneration";
import type { Settings } from "$lib/types/Settings";
import type { User } from "$lib/types/User";
import type { MessageEvent } from "$lib/types/MessageEvent";
import type { Session } from "$lib/types/Session";
import type { Assistant } from "$lib/types/Assistant";
import type { Report } from "$lib/types/Report";
import type { ConversationStats } from "$lib/types/ConversationStats";
import type { MigrationResult } from "$lib/types/MigrationResult";
import type { Semaphore } from "$lib/types/Semaphore";
import type { AssistantStats } from "$lib/types/AssistantStats";
import type { TokenCache } from "$lib/types/TokenCache";
import type { ConfigKey } from "$lib/types/ConfigKey";

export const CONVERSATION_STATS_COLLECTION = "conversations.stats";

// Stub collection type for backward compatibility
type StubCollection<T> = {
	find: (query?: unknown) => {
		toArray: () => Promise<T[]>;
		sort: (sort: unknown) => { toArray: () => Promise<T[]> };
		project: <P>(projection: unknown) => {
			sort: (sort: unknown) => { skip: (n: number) => { limit: (n: number) => { toArray: () => Promise<P[]> } } };
			toArray: () => Promise<P[]>;
		};
		skip: (n: number) => { limit: (n: number) => { toArray: () => Promise<T[]> } };
		limit: (n: number) => { toArray: () => Promise<T[]> };
	};
	findOne: (query?: unknown) => Promise<T | null>;
	insertOne: (doc: T) => Promise<{ insertedId: string; acknowledged: boolean }>;
	updateOne: (
		query: unknown,
		update: unknown,
		options?: unknown
	) => Promise<{ acknowledged: boolean; modifiedCount: number; matchedCount: number }>;
	deleteOne: (query: unknown) => Promise<{ deletedCount: number }>;
	deleteMany: (query: unknown) => Promise<{ deletedCount: number }>;
	countDocuments: (query?: unknown) => Promise<number>;
	createIndex: (keys: unknown, options?: unknown) => Promise<string>;
	clear: () => Promise<void>;
};

type StubGridFSBucket = {
	find: (query: unknown) => {
		next: () => Promise<{ _id: string } | null>;
	};
	openDownloadStream: (id: unknown) => {
		on: (event: string, handler: (chunk: unknown) => void) => void;
	};
};

type Collections = {
	conversations: StubCollection<Conversation>;
	conversationStats: StubCollection<ConversationStats>;
	assistants: StubCollection<Assistant>;
	assistantStats: StubCollection<AssistantStats>;
	reports: StubCollection<Report>;
	sharedConversations: StubCollection<SharedConversation>;
	abortedGenerations: StubCollection<AbortedGeneration>;
	settings: StubCollection<Settings>;
	users: StubCollection<User>;
	sessions: StubCollection<Session>;
	messageEvents: StubCollection<MessageEvent>;
	bucket: StubGridFSBucket;
	migrationResults: StubCollection<MigrationResult>;
	semaphores: StubCollection<Semaphore>;
	tokenCaches: StubCollection<TokenCache>;
	tools: StubCollection<unknown>;
	config: StubCollection<ConfigKey>;
};

// Create stub collections that return empty results
const createStubCollection = <T>(): StubCollection<T> => ({
	find: () => ({
		toArray: async () => [],
		sort: () => ({
			toArray: async () => [],
		}),
		project: () => ({
			sort: () => ({
				skip: () => ({
					limit: () => ({
						toArray: async () => [],
					}),
				}),
			}),
			toArray: async () => [],
		}),
		skip: () => ({
			limit: () => ({
				toArray: async () => [],
			}),
		}),
		limit: () => ({
			toArray: async () => [],
		}),
	}),
	findOne: async () => null,
	insertOne: async () => ({ insertedId: "", acknowledged: false }),
	updateOne: async () => ({ acknowledged: false, modifiedCount: 0, matchedCount: 0 }),
	deleteOne: async () => ({ deletedCount: 0 }),
	deleteMany: async () => ({ deletedCount: 0 }),
	countDocuments: async () => 0,
	createIndex: async () => "",
	clear: async () => {},
});

const createStubBucket = (): StubGridFSBucket => ({
	find: () => ({
		next: async () => null,
	}),
	openDownloadStream: () => ({
		on: () => {},
	}),
});

export const collections: Collections = {
	conversations: createStubCollection<Conversation>(),
	conversationStats: createStubCollection<ConversationStats>(),
	assistants: createStubCollection<Assistant>(),
	assistantStats: createStubCollection<AssistantStats>(),
	reports: createStubCollection<Report>(),
	sharedConversations: createStubCollection<SharedConversation>(),
	abortedGenerations: createStubCollection<AbortedGeneration>(),
	settings: createStubCollection<Settings>(),
	users: createStubCollection<User>(),
	sessions: createStubCollection<Session>(),
	messageEvents: createStubCollection<MessageEvent>(),
	bucket: createStubBucket(),
	migrationResults: createStubCollection<MigrationResult>(),
	semaphores: createStubCollection<Semaphore>(),
	tokenCaches: createStubCollection<TokenCache>(),
	tools: createStubCollection<unknown>(),
	config: createStubCollection<ConfigKey>(),
};

export const ready = Promise.resolve();

export async function getCollectionsEarly(): Promise<Collections> {
	return collections;
}
