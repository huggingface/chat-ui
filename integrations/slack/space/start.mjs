import { downloadFile } from "@huggingface/hub";
import { config } from "dotenv";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { MongoClient } from "mongodb";
import { snapshot, restore, readBackup, writeBackup, removeBackup } from "./state.mjs";
config({ path: "/app/.env", quiet: true });
const bucket = process.env.SLACK_ML_STATE_BUCKET;
const token = process.env.SLACK_ML_STATE_TOKEN;
if (token && token === process.env.SLACK_ML_HF_TOKEN)
	throw new Error("State and compute tokens must differ");
const dbName = process.env.MONGODB_DB_NAME;
if (!bucket || !token || !dbName)
	throw new Error("Configure SLACK_ML_STATE_BUCKET, SLACK_ML_STATE_TOKEN and MONGODB_DB_NAME");
const dbPath = await mkdtemp(join(tmpdir(), "slack-mongo-"));
const mongo = spawn(
	"mongod",
	[
		"--replSet",
		"state",
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
process.env.MONGODB_URL = "mongodb://127.0.0.1:27017/?directConnection=true";
const client = new MongoClient(process.env.MONGODB_URL, { serverSelectionTimeoutMS: 1000 });
let worker;
let timer;
let currentBackup = Promise.resolve();
let stopping = false;
let failures = 0;
async function save() {
	const path = await snapshot(client, dbName);
	try {
		await writeBackup(bucket, token, path);
	} finally {
		await removeBackup(path);
	}
}
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
		await save();
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
	await client
		.db("admin")
		.command({ replSetInitiate: { _id: "state", members: [{ _id: 0, host: "127.0.0.1:27017" }] } });
	for (let i = 0; !(await client.db("admin").command({ hello: 1 })).isWritablePrimary; i++) {
		if (i >= 60) throw new Error("MongoDB primary election timed out");
		await delay(500);
	}
	const path = await readBackup(bucket, token);
	let result;
	try {
		result = await restore(client, dbName, path);
	} finally {
		await removeBackup(path);
	}
	console.log(
		`[state] Restored ${result.collections} collections from ${result.createdAt.toISOString()}`
	);
	// A different token is not enough if the agent's token still has bucket access.
	try {
		const exposed = await downloadFile({
			repo: { type: "bucket", name: bucket },
			path: "latest.json.gz",
			accessToken: process.env.SLACK_ML_HF_TOKEN,
		});
		if (exposed) throw new Error("Compute token can read private state; restrict its permissions");
	} catch (error) {
		if (![401, 403, 404].includes(error.statusCode ?? error.status)) throw error;
	}
	// Prove write access before accepting Slack work.
	await save();
	const workerEnv = { ...process.env };
	delete workerEnv.SLACK_ML_STATE_TOKEN;
	delete workerEnv.SLACK_ML_DEPLOY_TOKEN;
	worker = spawn(process.execPath, ["server.js"], { stdio: "inherit", env: workerEnv });
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
				await save();
				failures = 0;
				console.log("[state] Backup saved");
			} catch {
				failures++;
				console.error(`[state] Backup failed (${failures})`);
			}
		})();
		currentBackup.then(() => {
			if (stopping) return;
			// Keep the live database rather than restarting into an older snapshot on backup failure.
			timer = setTimeout(backup, Math.min(300000, 30000 * Math.max(1, failures)));
		});
	};
	timer = setTimeout(backup, 30000);
} catch {
	console.error("[state] Startup/restore failed; refusing to start with missing state");
	await client.close();
	mongo.kill("SIGTERM");
	process.exit(1);
}
