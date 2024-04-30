import { env } from "$env/dynamic/private";
import { Collection, GridFSBucket, MongoClient } from "mongodb";
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
import { logger } from "$lib/server/logger";
import { building } from "$app/environment";

export const CONVERSATION_STATS_COLLECTION = "conversations.stats";

export class MongoDBClient {
	private static _instance: MongoClient;
	private static _collections: {
		conversations: Collection<Conversation>;
		conversationStats: Collection<ConversationStats>;
		assistants: Collection<Assistant>;
		assistantStats: Collection<AssistantStats>;
		reports: Collection<Report>;
		sharedConversations: Collection<SharedConversation>;
		abortedGenerations: Collection<AbortedGeneration>;
		settings: Collection<Settings>;
		users: Collection<User>;
		sessions: Collection<Session>;
		messageEvents: Collection<MessageEvent>;
		bucket: GridFSBucket;
		migrationResults: Collection<MigrationResult>;
		semaphores: Collection<Semaphore>;
	};

	private constructor() {}

	public static get instance(): MongoClient {
		if (!this._instance) {
			if (!env.MONGODB_URL && !building) {
				throw new Error("Please specify the MONGODB_URL environment variable inside .env.local.");
			}
			this._instance = new MongoClient(env.MONGODB_URL, {
				directConnection: env.MONGODB_DIRECT_CONNECTION === "true",
			});

			this._instance.connect().catch(logger.error);

			this._instance.once("open", async () => {
				logger.info("Connected to MongoDB");
				this.buildIndexes();
			});
		}
		return this._instance;
	}

	public static get collections() {
		if (!this._collections) {
			const db = this.instance.db(
				env.MONGODB_DB_NAME + (import.meta.env.MODE === "test" ? "-test" : "")
			);

			this._collections = {
				conversations: db.collection<Conversation>("conversations"),
				conversationStats: db.collection<ConversationStats>(CONVERSATION_STATS_COLLECTION),
				assistants: db.collection<Assistant>("assistants"),
				assistantStats: db.collection<AssistantStats>("assistants.stats"),
				reports: db.collection<Report>("reports"),
				sharedConversations: db.collection<SharedConversation>("sharedConversations"),
				abortedGenerations: db.collection<AbortedGeneration>("abortedGenerations"),
				settings: db.collection<Settings>("settings"),
				users: db.collection<User>("users"),
				sessions: db.collection<Session>("sessions"),
				messageEvents: db.collection<MessageEvent>("messageEvents"),
				bucket: new GridFSBucket(db, { bucketName: "files" }),
				migrationResults: db.collection<MigrationResult>("migrationResults"),
				semaphores: db.collection<Semaphore>("semaphores"),
			};
		}
		return this._collections;
	}

	private static buildIndexes() {
		const {
			conversations,
			conversationStats,
			abortedGenerations,
			settings,
			users,
			messageEvents,
			sessions,
			assistants,
			assistantStats,
			reports,
			sharedConversations,
			semaphores,
		} = this.collections;

		conversations
			.createIndex(
				{ sessionId: 1, updatedAt: -1 },
				{ partialFilterExpression: { sessionId: { $exists: true } } }
			)
			.catch(logger.error);
		conversations
			.createIndex(
				{ userId: 1, updatedAt: -1 },
				{ partialFilterExpression: { userId: { $exists: true } } }
			)
			.catch(logger.error);
		conversations
			.createIndex(
				{ "message.id": 1, "message.ancestors": 1 },
				{ partialFilterExpression: { userId: { $exists: true } } }
			)
			.catch(logger.error);
		// To do stats on conversations
		conversations.createIndex({ updatedAt: 1 }).catch(logger.error);
		// Not strictly necessary, could use _id, but more convenient. Also for stats
		conversations.createIndex({ createdAt: 1 }).catch(logger.error);
		// To do stats on conversation messages
		conversations.createIndex({ "messages.createdAt": 1 }, { sparse: true }).catch(logger.error);
		// Unique index for stats
		conversationStats
			.createIndex(
				{
					type: 1,
					"date.field": 1,
					"date.span": 1,
					"date.at": 1,
					distinct: 1,
				},
				{ unique: true }
			)
			.catch(logger.error);
		// Allow easy check of last computed stat for given type/dateField
		conversationStats
			.createIndex({
				type: 1,
				"date.field": 1,
				"date.at": 1,
			})
			.catch(logger.error);
		abortedGenerations
			.createIndex({ updatedAt: 1 }, { expireAfterSeconds: 30 })
			.catch(logger.error);
		abortedGenerations.createIndex({ conversationId: 1 }, { unique: true }).catch(logger.error);
		sharedConversations.createIndex({ hash: 1 }, { unique: true }).catch(logger.error);
		settings.createIndex({ sessionId: 1 }, { unique: true, sparse: true }).catch(logger.error);
		settings.createIndex({ userId: 1 }, { unique: true, sparse: true }).catch(logger.error);
		settings.createIndex({ assistants: 1 }).catch(logger.error);
		users.createIndex({ hfUserId: 1 }, { unique: true }).catch(logger.error);
		users.createIndex({ sessionId: 1 }, { unique: true, sparse: true }).catch(logger.error);
		// No unicity because due to renames & outdated info from oauth provider, there may be the same username on different users
		users.createIndex({ username: 1 }).catch(logger.error);
		messageEvents.createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 }).catch(logger.error);
		sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(logger.error);
		sessions.createIndex({ sessionId: 1 }, { unique: true }).catch(logger.error);
		assistants.createIndex({ createdById: 1, userCount: -1 }).catch(logger.error);
		assistants.createIndex({ userCount: 1 }).catch(logger.error);
		assistants.createIndex({ featured: 1, userCount: -1 }).catch(logger.error);
		assistants.createIndex({ modelId: 1, userCount: -1 }).catch(logger.error);
		assistants.createIndex({ searchTokens: 1 }).catch(logger.error);
		assistants.createIndex({ last24HoursCount: 1 }).catch(logger.error);
		assistantStats
			// Order of keys is important for the queries
			.createIndex({ "date.span": 1, "date.at": 1, assistantId: 1 }, { unique: true })
			.catch(logger.error);
		reports.createIndex({ assistantId: 1 }).catch(logger.error);
		reports.createIndex({ createdBy: 1, assistantId: 1 }).catch(logger.error);

		// Unique index for semaphore and migration results
		semaphores.createIndex({ key: 1 }, { unique: true }).catch(logger.error);
		semaphores.createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 }).catch(logger.error);
	}
}

export const collections = !building
	? MongoDBClient.collections
	: ({} as (typeof MongoDBClient)["_collections"]);
