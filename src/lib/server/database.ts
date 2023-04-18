import { MongoClient, ObjectID } from 'mongodb';

// Set up the MongoDB database connection
const url = 'mongodb://localhost:27017';
const dbName = 'chat';
export let db;

// MongoClient.connect(url, { useNewUrlParser: true, useUnifiedTopology: true }, (err, client) => {
// 	if (err) {
// 		console.error(err);
// 		return;
// 	}
// 	console.log('Connected to MongoDB');
// 	db = client.db(dbName);
// });

export async function getConversations() {
	const module = await import('../../data/conversations.json');
	const conversations = module.default;
	// const conversations = await db.collection('conversations').find().toArray();
	return conversations;
}

export async function getConversation(conversationId: string) {
	const module = await import('../../data/conversation_1.json');
	const conversation = module.default;
	// const conversation = await db.collection('conversations').findOne({ _id: conversationId });
	return conversation;
}

export async function addMessage(conversation: Conversation, message: string) {
	// await db
	// 	.collection('conversations')
	// 	.updateOne(
	// 		{ _id: conversation.id },
	// 		{ $set: { messages: [...conversation.messages, message] } }
	// 	);
}
