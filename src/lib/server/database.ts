import { MongoClient, ObjectID } from 'mongodb';

// Set up the MongoDB database connection
const url = 'mongodb://localhost:27017';
const dbName = 'chat';
// export let db;

// MongoClient.connect(url, { useNewUrlParser: true, useUnifiedTopology: true }, (err, client) => {
// 	if (err) {
// 		console.error(err);
// 		return;
// 	}
// 	console.log('Connected to MongoDB');
// 	db = client.db(dbName);
// });

export async function getConversations(userId: string) {
	const module = await import('../../data/conversations.json');
	const conversations = module.default;
	// const conversations = await db.collection('conversations').find().toArray();
	return conversations;
}
