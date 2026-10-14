import test from "node:test";
import assert from "node:assert/strict";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient, ObjectId } from "mongodb";
import { snapshot, restore, removeBackup } from "./state.mjs";
test("consistent snapshot restores BSON, indexes, and isolated collections; rejects corrupt data", async () => {
	const server = await MongoMemoryReplSet.create();
	const client = await new MongoClient(server.getUri()).connect();
	try {
		const id = new ObjectId(),
			date = new Date();
		await client
			.db("source")
			.collection("threads")
			.insertMany([
				{ _id: id, owner: "alice", date },
				{ owner: "bob", date },
			]);
		await client.db("source").collection("threads").createIndex({ owner: 1 }, { unique: true });
		await client.db("source").collection("private").insertOne({ secret: "excluded" });
		const bytes = await snapshot(client, "source", { threads: { owner: "alice" } });
		await restore(client, "target", bytes);
		const docs = await client.db("target").collection("threads").find().toArray();
		assert.equal(docs.length, 1);
		assert.ok(docs[0]._id.equals(id));
		assert.equal(docs[0].date.getTime(), date.getTime());
		assert.equal((await client.db("target").listCollections().toArray()).length, 1);
		await assert.rejects(client.db("target").collection("threads").insertOne({ owner: "alice" }));
		await assert.rejects(restore(client, "target", bytes), /empty database/);
		await assert.rejects(restore(client, "bad", Buffer.from("bad")));
		assert.equal((await client.db("bad").listCollections().toArray()).length, 0);
		await removeBackup(bytes);
		// Snapshot reads never lock application writes.
		await client.db("source").collection("threads").insertOne({ owner: "charlie" });
	} finally {
		await client.close();
		await server.stop();
	}
});
