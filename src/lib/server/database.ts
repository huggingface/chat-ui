import { MONGODB_URL, MONGODB_DB_NAME, MONGODB_DIRECT_CONNECTION } from "$env/static/private";
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

if (!MONGODB_URL) {
	throw new Error(
		"Please specify the MONGODB_URL environment variable inside .env.local. Set it to mongodb://localhost:27017 if you are running MongoDB locally, or to a MongoDB Atlas free instance for example."
	);
}
export const CONVERSATION_STATS_COLLECTION = "conversations.stats";

export function getCollections(mongoClient: MongoClient) {
	const db = mongoClient.db(MONGODB_DB_NAME + (import.meta.env.MODE === "test" ? "-test" : ""));

	const conversations = db.collection<Conversation>("conversations");
	const conversationStats = db.collection<ConversationStats>(CONVERSATION_STATS_COLLECTION);
	const assistants = db.collection<Assistant>("assistants");
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

	return {
		conversations,
		conversationStats,
		assistants,
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
	};
}

const client = new MongoClient(MONGODB_URL, {
	directConnection: MONGODB_DIRECT_CONNECTION === "true",
});

export const connectPromise = client.connect().catch(console.error);

const db = client.db(MONGODB_DB_NAME + (import.meta.env.MODE === "test" ? "-test" : ""));
const collections = getCollections(client);

export { client, db, collections };

client.on("open", () => {
	collections.conversations
		.createIndex(
			{ sessionId: 1, updatedAt: -1 },
			{ partialFilterExpression: { sessionId: { $exists: true } } }
		)
		.catch(console.error);
	collections.conversations
		.createIndex(
			{ userId: 1, updatedAt: -1 },
			{ partialFilterExpression: { userId: { $exists: true } } }
		)
		.catch(console.error);
	collections.conversations
		.createIndex(
			{ "message.id": 1, "message.ancestors": 1 },
			{ partialFilterExpression: { userId: { $exists: true } } }
		)
		.catch(console.error);
	// To do stats on conversations
	collections.conversations.createIndex({ updatedAt: 1 }).catch(console.error);
	// Not strictly necessary, could use _id, but more convenient. Also for stats
	collections.conversations.createIndex({ createdAt: 1 }).catch(console.error);
	// To do stats on conversation messages
	collections.conversations
		.createIndex({ "messages.createdAt": 1 }, { sparse: true })
		.catch(console.error);
	// Unique index for stats
	collections.conversationStats
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
		.catch(console.error);
	// Allow easy check of last computed stat for given type/dateField
	collections.conversationStats
		.createIndex({
			type: 1,
			"date.field": 1,
			"date.at": 1,
		})
		.catch(console.error);
	collections.abortedGenerations
		.createIndex({ updatedAt: 1 }, { expireAfterSeconds: 30 })
		.catch(console.error);
	collections.abortedGenerations
		.createIndex({ conversationId: 1 }, { unique: true })
		.catch(console.error);
	collections.sharedConversations.createIndex({ hash: 1 }, { unique: true }).catch(console.error);
	collections.settings
		.createIndex({ sessionId: 1 }, { unique: true, sparse: true })
		.catch(console.error);
	collections.settings
		.createIndex({ userId: 1 }, { unique: true, sparse: true })
		.catch(console.error);
	collections.settings.createIndex({ assistants: 1 }).catch(console.error);
	collections.users.createIndex({ hfUserId: 1 }, { unique: true }).catch(console.error);
	collections.users
		.createIndex({ sessionId: 1 }, { unique: true, sparse: true })
		.catch(console.error);
	// No unicity because due to renames & outdated info from oauth provider, there may be the same username on different users
	collections.users.createIndex({ username: 1 }).catch(console.error);
	collections.messageEvents
		.createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 })
		.catch(console.error);
	collections.sessions
		.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
		.catch(console.error);
	collections.sessions.createIndex({ sessionId: 1 }, { unique: true }).catch(console.error);
	collections.assistants.createIndex({ createdById: 1, userCount: -1 }).catch(console.error);
	collections.assistants.createIndex({ userCount: 1 }).catch(console.error);
	collections.assistants.createIndex({ featured: 1, userCount: -1 }).catch(console.error);
	collections.assistants.createIndex({ modelId: 1, userCount: -1 }).catch(console.error);
	collections.reports.createIndex({ assistantId: 1 }).catch(console.error);
	collections.reports.createIndex({ createdBy: 1, assistantId: 1 }).catch(console.error);

	// Unique index for semaphore and migration results
	collections.migrationResults.createIndex({ guid: 1 }, { unique: true }).catch(console.error);
	collections.semaphores.createIndex({ key: 1 }, { unique: true }).catch(console.error);
});
