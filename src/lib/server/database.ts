import { MONGODB_URL, MONGODB_DB_NAME } from '$env/static/private';
import { MongoClient } from 'mongodb';
import type { Conversation } from '$lib/types/Conversation';

const client = new MongoClient(MONGODB_URL, {
	// directConnection: true
});

export const connectPromise = client.connect().catch(console.error);

const db = client.db(MONGODB_DB_NAME);

const conversations = db.collection<Conversation>('conversations');

export { client, db };
export const collections = { conversations };

client.on('open', () => {
	conversations.createIndex({ sessionId: 1, updatedAt: -1 });
});
