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

if (!MONGODB_URL) {
	throw new Error(
		"Please specify the MONGODB_URL environment variable inside .env.local. Set it to mongodb://localhost:27017 if you are running MongoDB locally, or to a MongoDB Atlas free instance for example."
	);
}

const client = new MongoClient(MONGODB_URL, {
	directConnection: MONGODB_DIRECT_CONNECTION === "true",
});

export const connectPromise = client.connect().catch(console.error);

const db = client.db(MONGODB_DB_NAME + (import.meta.env.MODE === "test" ? "-test" : ""));

export const CONVERSATION_STATS_COLLECTION = "conversations.stats";

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

export { client, db };
export const collections = {
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
};

client.on("open", () => {
	conversations
		.createIndex(
			{ sessionId: 1, updatedAt: -1 },
			{ partialFilterExpression: { sessionId: { $exists: true } } }
		)
		.catch(console.error);
	conversations
		.createIndex(
			{ userId: 1, updatedAt: -1 },
			{ partialFilterExpression: { userId: { $exists: true } } }
		)
		.catch(console.error);
	conversations
		.createIndex(
			{ "message.id": 1, "message.ancestors": 1 },
			{ partialFilterExpression: { userId: { $exists: true } } }
		)
		.catch(console.error);
	// To do stats on conversations
	conversations.createIndex({ updatedAt: 1 }).catch(console.error);
	// Not strictly necessary, could use _id, but more convenient. Also for stats
	conversations.createIndex({ createdAt: 1 }).catch(console.error);
	// To do stats on conversation messages
	conversations.createIndex({ "messages.createdAt": 1 }, { sparse: true }).catch(console.error);
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
		.catch(console.error);
	// Allow easy check of last computed stat for given type/dateField
	conversationStats
		.createIndex({
			type: 1,
			"date.field": 1,
			"date.at": 1,
		})
		.catch(console.error);
	abortedGenerations.createIndex({ updatedAt: 1 }, { expireAfterSeconds: 30 }).catch(console.error);
	abortedGenerations.createIndex({ conversationId: 1 }, { unique: true }).catch(console.error);
	sharedConversations.createIndex({ hash: 1 }, { unique: true }).catch(console.error);
	settings.createIndex({ sessionId: 1 }, { unique: true, sparse: true }).catch(console.error);
	settings.createIndex({ userId: 1 }, { unique: true, sparse: true }).catch(console.error);
	settings.createIndex({ assistants: 1 }).catch(console.error);
	users.createIndex({ hfUserId: 1 }, { unique: true }).catch(console.error);
	users.createIndex({ sessionId: 1 }, { unique: true, sparse: true }).catch(console.error);
	// No unicity because due to renames & outdated info from oauth provider, there may be the same username on different users
	users.createIndex({ username: 1 }).catch(console.error);
	messageEvents.createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 }).catch(console.error);
	sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(console.error);
	sessions.createIndex({ sessionId: 1 }, { unique: true }).catch(console.error);
	assistants.createIndex({ createdById: 1, userCount: -1 }).catch(console.error);
	assistants.createIndex({ userCount: 1 }).catch(console.error);
	assistants.createIndex({ featured: 1, userCount: -1 }).catch(console.error);
	assistants.createIndex({ modelId: 1, userCount: -1 }).catch(console.error);
	reports.createIndex({ assistantId: 1 }).catch(console.error);
	reports.createIndex({ createdBy: 1, assistantId: 1 }).catch(console.error);
});
