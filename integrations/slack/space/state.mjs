import { BSON } from "mongodb";
import { gzipSync, gunzipSync } from "node:zlib";
import { downloadFile, uploadFiles } from "@huggingface/hub";

// Lock only while reading; compression and network I/O happen after unlocking.
export async function snapshot(client, dbName, selectors) {
	const db = client.db(dbName);
	const collections = [];
	await client.db("admin").command({ fsync: 1, lock: true });
	try {
		for (const entry of await db.listCollections({}, { nameOnly: true }).toArray()) {
			if (entry.name.startsWith("system.") || (selectors && !(entry.name in selectors))) continue;
			const collection = db.collection(entry.name);
			collections.push({
				name: entry.name,
				documents: await collection.find(selectors?.[entry.name] ?? {}).toArray(),
				indexes: await collection.listIndexes().toArray(),
			});
		}
	} finally {
		await client.db("admin").command({ fsyncUnlock: 1 });
	}
	return gzipSync(
		BSON.EJSON.stringify({ version: 1, createdAt: new Date(), collections }, { relaxed: false })
	);
}

export async function restore(client, dbName, bytes) {
	const data = BSON.EJSON.parse(gunzipSync(bytes).toString(), { relaxed: false });
	if (Number(data.version) !== 1 || !Array.isArray(data.collections) || !data.collections.length)
		throw new Error("Invalid or empty state snapshot");
	const names = new Set();
	for (const c of data.collections) {
		if (
			typeof c.name !== "string" ||
			c.name.startsWith("system.") ||
			names.has(c.name) ||
			!Array.isArray(c.documents) ||
			!Array.isArray(c.indexes)
		)
			throw new Error("Invalid snapshot collection");
		names.add(c.name);
	}
	const db = client.db(dbName);
	if ((await db.listCollections().toArray()).length)
		throw new Error("Restore requires an empty database");
	for (const c of data.collections) {
		const collection = await db.createCollection(c.name);
		if (c.documents.length) await collection.insertMany(c.documents);
		for (const index of c.indexes) {
			if (index.name === "_id_") continue;
			const { key, ...options } = index;
			delete options.v;
			delete options.ns;
			await collection.createIndex(key, options);
		}
	}
	return { createdAt: data.createdAt, collections: data.collections.length };
}

export async function readBackup(bucket, accessToken) {
	const blob = await downloadFile({
		repo: { type: "bucket", name: bucket },
		path: "latest.json.gz",
		accessToken,
	});
	if (!blob) throw new Error("No state snapshot found; seed the private bucket before startup");
	return Buffer.from(await blob.arrayBuffer());
}
export async function writeBackup(bucket, accessToken, bytes) {
	await uploadFiles({
		repo: { type: "bucket", name: bucket },
		accessToken,
		files: [{ path: "latest.json.gz", content: new Blob([bytes]) }],
	});
}
