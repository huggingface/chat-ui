import { MONGODB_URL, MONGODB_DB_NAME } from "$env/static/private";
import { MongoClient } from "mongodb";
import type { Conversation } from "$lib/types/Conversation";
import type { SharedConversation } from "$lib/types/SharedConversation";
import type { AbortedGeneration } from "$lib/types/AbortedGeneration";
import type { Settings } from "$lib/types/Settings";
import type { User } from "$lib/types/User";

const client = new MongoClient(MONGODB_URL, {
	// directConnection: true
});

export const connectPromise = client.connect().catch(console.error);

const db = client.db(MONGODB_DB_NAME);

const conversations = db.collection<Conversation>("conversations");
const sharedConversations = db.collection<SharedConversation>("sharedConversations");
const abortedGenerations = db.collection<AbortedGeneration>("abortedGenerations");
const settings = db.collection<Settings>("settings");
const users = db.collection<User>("users");

export { client, db };
export const collections = {
	conversations,
	sharedConversations,
	abortedGenerations,
	settings,
	users,
};

client.on("open", () => {
	conversations.createIndex(
		{ sessionId: 1, updatedAt: -1 },
		{ partialFilterExpression: { sessionId: { $exists: true } } }
	);
	conversations.createIndex(
		{ userId: 1, updatedAt: -1 },
		{ partialFilterExpression: { userId: { $exists: true } } }
	);
	abortedGenerations.createIndex({ updatedAt: 1 }, { expireAfterSeconds: 30 });
	abortedGenerations.createIndex({ conversationId: 1 }, { unique: true });
	sharedConversations.createIndex({ hash: 1 }, { unique: true });
	settings.createIndex({ sessionId: 1 }, { unique: true, sparse: true });
	settings.createIndex({ userId: 1 }, { unique: true, sparse: true });
	users.createIndex({ hfUserId: 1 }, { unique: true });
	users.createIndex({ sessionId: 1 }, { unique: true, sparse: true });
});
