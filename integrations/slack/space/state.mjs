import { BSON } from "mongodb";
import { createGzip, createGunzip } from "node:zlib";
import { downloadFile, uploadFiles } from "@huggingface/hub";
import { createReadStream, createWriteStream, openAsBlob } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInterface } from "node:readline";

export async function removeBackup(path) {
	if (typeof path === "string") await rm(dirname(path), { recursive: true, force: true });
}
async function temporary() {
	return join(await mkdtemp(join(tmpdir(), "ml-state-")), "snapshot.gz");
}
// A snapshot session pins one read timestamp across collections without locking writes.
// Records are encoded individually; neither a database-sized string nor buffer is created.
export async function snapshot(client, dbName, selectors) {
	const path = await temporary();
	const session = client.startSession({ snapshot: true });
	const db = client.db(dbName);
	async function* records() {
		yield BSON.EJSON.stringify({ version: 2, createdAt: new Date() }, { relaxed: false }) + "\n";
		let count = 0;
		for (const entry of await db.listCollections({}, { nameOnly: true }).toArray()) {
			if (entry.name.startsWith("system.") || (selectors && !(entry.name in selectors))) continue;
			const collection = db.collection(entry.name);
			yield BSON.EJSON.stringify(
				{ collection: entry.name, indexes: await collection.listIndexes().toArray() },
				{ relaxed: false }
			) + "\n";
			for await (const document of collection.find(selectors?.[entry.name] ?? {}, {
				session,
				batchSize: 16,
			}))
				yield BSON.EJSON.stringify({ document }, { relaxed: false }) + "\n";
			count++;
		}
		yield JSON.stringify({ end: true, collections: count }) + "\n";
	}
	try {
		await pipeline(Readable.from(records()), createGzip(), createWriteStream(path));
		return path;
	} catch (error) {
		await removeBackup(path);
		throw error;
	} finally {
		await session.endSession();
	}
}
export async function restore(client, dbName, bytes) {
	const db = client.db(dbName);
	if ((await db.listCollections().toArray()).length)
		throw new Error("Restore requires an empty database");
	const source = typeof bytes === "string" ? createReadStream(bytes) : Readable.from([bytes]);
	const decoded = source.pipe(createGunzip());
	source.on("error", (error) => decoded.destroy(error));
	const lines = createInterface({ input: decoded, crlfDelay: Infinity });
	let header,
		collection,
		count = 0,
		ended = false;
	const names = new Set();
	async function create(name, indexes) {
		if (
			typeof name !== "string" ||
			name.startsWith("system.") ||
			names.has(name) ||
			!Array.isArray(indexes)
		)
			throw new Error("Invalid snapshot collection");
		names.add(name);
		const c = await db.createCollection(name);
		for (const index of indexes) {
			if (index.name === "_id_") continue;
			const { key, v, ns, ...options } = index;
			void v;
			void ns;
			await c.createIndex(key, options);
		}
		count++;
		return c;
	}
	try {
		for await (const line of lines) {
			const row = BSON.EJSON.parse(line, { relaxed: false });
			if (!header) {
				header = row;
				// One-time compatibility with the old single-string seed/backups.
				if (Number(row.version) === 1 && Array.isArray(row.collections) && row.collections.length) {
					for (const c of row.collections) {
						if (!Array.isArray(c.documents)) throw new Error("Invalid snapshot");
						const target = await create(c.name, c.indexes);
						for (const doc of c.documents) await target.insertOne(doc);
					}
					ended = true;
				} else if (Number(row.version) !== 2) throw new Error("Invalid state snapshot");
			} else if (ended) throw new Error("Unexpected trailing snapshot records");
			else if (row.collection) collection = await create(row.collection, row.indexes);
			else if (row.document && collection) await collection.insertOne(row.document);
			else if (row.end && Number(row.collections) === count) ended = true;
			else throw new Error("Invalid snapshot record");
		}
		if (!ended || !count) throw new Error("Incomplete or empty snapshot");
		return { createdAt: header.createdAt, collections: count };
	} finally {
		lines.close();
		source.destroy();
		decoded.destroy();
	}
}
export async function readBackup(bucket, accessToken) {
	const blob = await downloadFile({
		repo: { type: "bucket", name: bucket },
		path: "latest.json.gz",
		accessToken,
	});
	if (!blob) throw new Error("No state snapshot found; seed the private bucket before startup");
	const path = await temporary();
	try {
		await pipeline(Readable.fromWeb(blob.stream()), createWriteStream(path));
		return path;
	} catch (error) {
		await removeBackup(path);
		throw error;
	}
}
export async function writeBackup(bucket, accessToken, bytes) {
	await uploadFiles({
		repo: { type: "bucket", name: bucket },
		accessToken,
		files: [
			{
				path: "latest.json.gz",
				content: typeof bytes === "string" ? await openAsBlob(bytes) : new Blob([bytes]),
			},
		],
	});
}
