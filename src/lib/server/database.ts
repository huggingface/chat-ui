import { env } from "$env/dynamic/private";
import { GridFSBucket, MongoClient } from "mongodb";
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
import type { CommunityToolDB } from "$lib/types/Tool";

import { logger } from "$lib/server/logger";
import { building } from "$app/environment";
import type { TokenCache } from "$lib/types/TokenCache";
import { onExit } from "./exitHandler";

export const CONVERSATION_STATS_COLLECTION = "conversations.stats";

export class Database {
	private client: MongoClient;

	private static instance: Database;

	private constructor() {
		if (!env.MONGODB_URL) {
			throw new Error(
				"Please specify the MONGODB_URL environment variable inside .env.local. Set it to mongodb://localhost:27017 if you are running MongoDB locally, or to a MongoDB Atlas free instance for example."
			);
		}

		this.client = new MongoClient(env.MONGODB_URL, {
			directConnection: env.MONGODB_DIRECT_CONNECTION === "true",
		});

		this.client.connect().catch((err) => {
			logger.error(err, "Connection error");
			process.exit(1);
		});
		this.client.db(env.MONGODB_DB_NAME + (import.meta.env.MODE === "test" ? "-test" : ""));
		this.client.on("open", () => this.initDatabase());

		// Disconnect DB on exit
		onExit(() => this.client.close(true));
	}

	public static getInstance(): Database {
		if (!Database.instance) {
			Database.instance = new Database();
		}

		return Database.instance;
	}

	/**
	 * Return mongoClient
	 */
	public getClient(): MongoClient {
		return this.client;
	}

	/**
	 * Return map of database's collections
	 */
	public getCollections() {
		const db = this.client.db(
			env.MONGODB_DB_NAME + (import.meta.env.MODE === "test" ? "-test" : "")
		);

		const conversations = db.collection<Conversation>("conversations");
		const conversationStats = db.collection<ConversationStats>(CONVERSATION_STATS_COLLECTION);
		const assistants = db.collection<Assistant>("assistants");
		const assistantStats = db.collection<AssistantStats>("assistants.stats");
		const reports = db.collection<Report>("reports");
		const sharedConversations = db.collection<SharedConversation>("sharedConversations");
		const abortedGenerations = db.collection<AbortedGeneration>("abortedGenerations");
		const settings = db.collection<Settings>("settings");
		const users = db.collection<User>("users");
		const sessions = db.collection<Session>("sessions");
		const messageEvents = db.collection<MessageEvent>("messageEvents");
		const bucket = new GridFSBucket(db, { bucketName: "files" });
		const migrationResults = db.collection<MigrationResult>("migrationResults");
		const semaphores = db.collection<Semaphore>("semaphores");
		const tokenCaches = db.collection<TokenCache>("tokens");
		const tools = db.collection<CommunityToolDB>("tools");

		return {
			conversations,
			conversationStats,
			assistants,
			assistantStats,
			reports,
			sharedConversations,
			abortedGenerations,
			settings,
			users,
			sessions,
			messageEvents,
			bucket,
			migrationResults,
			semaphores,
			tokenCaches,
			tools,
		};
	}

	/**
	 * Init database once connected: Index creation
	 * @private
	 */
	private initDatabase() {
		const {
			conversations,
			conversationStats,
			assistants,
			assistantStats,
			reports,
			sharedConversations,
			abortedGenerations,
			settings,
			users,
			sessions,
			messageEvents,
			semaphores,
			tokenCaches,
			tools,
		} = this.getCollections();

		conversations
			.createIndex(
				{ sessionId: 1, updatedAt: -1 },
				{ partialFilterExpression: { sessionId: { $exists: true } } }
			)
			.catch((e) => logger.error(e));
		conversations
			.createIndex(
				{ userId: 1, updatedAt: -1 },
				{ partialFilterExpression: { userId: { $exists: true } } }
			)
			.catch((e) => logger.error(e));
		conversations
			.createIndex(
				{ "message.id": 1, "message.ancestors": 1 },
				{ partialFilterExpression: { userId: { $exists: true } } }
			)
			.catch((e) => logger.error(e));
		// Not strictly necessary, could use _id, but more convenient. Also for stats
		// To do stats on conversation messages
		conversations
			.createIndex({ "messages.createdAt": 1 }, { sparse: true })
			.catch((e) => logger.error(e));
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
			.catch((e) => logger.error(e));
		// Allow easy check of last computed stat for given type/dateField
		conversationStats
			.createIndex({
				type: 1,
				"date.field": 1,
				"date.at": 1,
			})
			.catch((e) => logger.error(e));
		abortedGenerations
			.createIndex({ updatedAt: 1 }, { expireAfterSeconds: 30 })
			.catch((e) => logger.error(e));
		abortedGenerations
			.createIndex({ conversationId: 1 }, { unique: true })
			.catch((e) => logger.error(e));
		sharedConversations.createIndex({ hash: 1 }, { unique: true }).catch((e) => logger.error(e));
		settings
			.createIndex({ sessionId: 1 }, { unique: true, sparse: true })
			.catch((e) => logger.error(e));
		settings
			.createIndex({ userId: 1 }, { unique: true, sparse: true })
			.catch((e) => logger.error(e));
		settings.createIndex({ assistants: 1 }).catch((e) => logger.error(e));
		users.createIndex({ hfUserId: 1 }, { unique: true }).catch((e) => logger.error(e));
		users
			.createIndex({ sessionId: 1 }, { unique: true, sparse: true })
			.catch((e) => logger.error(e));
		// No unicity because due to renames & outdated info from oauth provider, there may be the same username on different users
		users.createIndex({ username: 1 }).catch((e) => logger.error(e));
		messageEvents
			.createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 })
			.catch((e) => logger.error(e));
		sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch((e) => logger.error(e));
		sessions.createIndex({ sessionId: 1 }, { unique: true }).catch((e) => logger.error(e));
		assistants.createIndex({ createdById: 1, userCount: -1 }).catch((e) => logger.error(e));
		assistants.createIndex({ userCount: 1 }).catch((e) => logger.error(e));
		assistants.createIndex({ featured: 1, userCount: -1 }).catch((e) => logger.error(e));
		assistants.createIndex({ modelId: 1, userCount: -1 }).catch((e) => logger.error(e));
		assistants.createIndex({ searchTokens: 1 }).catch((e) => logger.error(e));
		assistants.createIndex({ last24HoursCount: 1 }).catch((e) => logger.error(e));
		assistants
			.createIndex({ last24HoursUseCount: -1, useCount: -1, _id: 1 })
			.catch((e) => logger.error(e));
		assistantStats
			// Order of keys is important for the queries
			.createIndex({ "date.span": 1, "date.at": 1, assistantId: 1 }, { unique: true })
			.catch((e) => logger.error(e));
		reports.createIndex({ assistantId: 1 }).catch((e) => logger.error(e));
		reports.createIndex({ createdBy: 1, assistantId: 1 }).catch((e) => logger.error(e));

		// Unique index for semaphore and migration results
		semaphores.createIndex({ key: 1 }, { unique: true }).catch((e) => logger.error(e));
		semaphores
			.createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 })
			.catch((e) => logger.error(e));
		tokenCaches
			.createIndex({ createdAt: 1 }, { expireAfterSeconds: 5 * 60 })
			.catch((e) => logger.error(e));
		tokenCaches.createIndex({ tokenHash: 1 }).catch((e) => logger.error(e));
		tools.createIndex({ createdById: 1, userCount: -1 }).catch((e) => logger.error(e));
		tools.createIndex({ userCount: 1 }).catch((e) => logger.error(e));
		tools.createIndex({ last24HoursCount: 1 }).catch((e) => logger.error(e));
	}
}

export const collections = building
	? ({} as unknown as ReturnType<typeof Database.prototype.getCollections>)
	: Database.getInstance().getCollections();
