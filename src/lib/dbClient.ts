import { MongoClient } from 'mongodb';

// Set up the MongoDB database connection
const url = 'mongodb://localhost:27017';
const dbName = 'chat';
export let db;

MongoClient.connect(url)
	.then((client) => {
		console.log('Connected to MongoDB');
		db = client.db(dbName);
	})
	.catch((err) => {
		console.error(err);
	});
