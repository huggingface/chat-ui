import { config } from "dotenv";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { MongoClient } from "mongodb";
import { snapshot, restore, readBackup, writeBackup } from "./state.mjs";
config({ path: "/app/.env", quiet: true });
const bucket = process.env.SLACK_ML_STATE_BUCKET;
const token = process.env.SLACK_ML_HF_TOKEN;
const dbName = process.env.MONGODB_DB_NAME;
if (!bucket || !token || !dbName)
	throw new Error("Configure SLACK_ML_STATE_BUCKET, SLACK_ML_HF_TOKEN and MONGODB_DB_NAME");
const dbPath = await mkdtemp(join(tmpdir(), "slack-mongo-"));
const mongo = spawn(
	"mongod",
	[
		"--bind_ip",
		"127.0.0.1",
		"--port",
		"27017",
		"--dbpath",
		dbPath,
		"--quiet",
		"--logpath",
		join(dbPath, "mongo.log"),
	],
	{ stdio: "ignore" }
);
mongo.on("error", () => {
	console.error("[state] MongoDB failed to start");
	process.exit(1);
});
process.env.MONGODB_URL = "mongodb://127.0.0.1:27017";
const client = new MongoClient(process.env.MONGODB_URL, { serverSelectionTimeoutMS: 1000 });
let worker;
let timer;
let currentBackup = Promise.resolve();
let stopping = false;
let failures = 0;
async function stop(code) {
	if (stopping) return;
	stopping = true;
	clearTimeout(timer);
	if (worker && worker.exitCode === null && worker.signalCode === null) {
		worker.kill("SIGTERM");
		for (let i = 0; i < 100 && worker.exitCode === null && worker.signalCode === null; i++)
			await delay(100);
		if (worker.exitCode === null && worker.signalCode === null) worker.kill("SIGKILL");
	}
	try {
		await currentBackup;
		await writeBackup(bucket, token, await snapshot(client, dbName));
		console.log("[state] Final backup saved");
	} catch {
		console.error("[state] Final backup failed");
		code = 1;
	}
	await client.close();
	mongo.kill("SIGTERM");
	process.exit(code);
}
try {
	for (let i = 0; ; i++) {
		try {
			await client.connect();
			await client.db("admin").command({ ping: 1 });
			break;
		} catch {
			if (i >= 30) throw new Error("MongoDB startup timed out");
			await delay(500);
		}
	}
	const result = await restore(client, dbName, await readBackup(bucket, token));
	console.log(
		`[state] Restored ${result.collections} collections from ${result.createdAt.toISOString()}`
	);
	// Prove write access before accepting Slack work.
	await writeBackup(bucket, token, await snapshot(client, dbName));
	worker = spawn(process.execPath, ["server.js"], { stdio: "inherit", env: process.env });
	worker.on("exit", () => {
		if (!stopping) void stop(1);
	});
	mongo.on("exit", () => {
		if (!stopping) {
			worker.kill("SIGTERM");
			process.exit(1);
		}
	});
	process.on("SIGTERM", () => void stop(0));
	process.on("SIGINT", () => void stop(0));
	const backup = () => {
		currentBackup = (async () => {
			try {
				await writeBackup(bucket, token, await snapshot(client, dbName));
				failures = 0;
				console.log("[state] Backup saved");
			} catch {
				failures++;
				console.error(`[state] Backup failed (${failures}/3)`);
			}
		})();
		currentBackup.then(() => {
			if (stopping) return;
			if (failures >= 3) void stop(1);
			else timer = setTimeout(backup, 30000);
		});
	};
	timer = setTimeout(backup, 30000);
} catch {
	console.error("[state] Startup/restore failed; refusing to start with missing state");
	await client.close();
	mongo.kill("SIGTERM");
	process.exit(1);
}
