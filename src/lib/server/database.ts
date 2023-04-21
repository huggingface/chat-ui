import { MONGODB_URL, MONGODB_DB_NAME } from "$env/static/private";
import { MongoClient } from "mongodb";
import type { Conversation } from "$lib/types/Conversation";
import type { SharedConversation } from "$lib/types/SharedConversation";

const client = new MongoClient(MONGODB_URL, {
	// directConnection: true
});

export const connectPromise = client.connect().catch(console.error);

const db = client.db(MONGODB_DB_NAME);

const conversations = db.collection<Conversation>("conversations");
const sharedConversations = db.collection<SharedConversation>("sharedConversations");

export { client, db };
export const collections = { conversations, sharedConversations };

client.on("open", () => {
	conversations.createIndex({ sessionId: 1, updatedAt: -1 });
	sharedConversations.createIndex({ hash: 1 }, { unique: true });
});
