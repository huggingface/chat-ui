import sade from "sade";

// @ts-expect-error: vite-node makes the var available but the typescript compiler doesn't see them
import { config } from "$lib/server/config";

const prog = sade("config");

prog
	.command("clear")
	.describe("Clear all config keys")
	.action(async () => {
		console.log("Clearing config...");
		await clear();
	});

prog
	.command("add <key> <value>")
	.describe("Add a new config key")
	.action(async (key: string, value: string) => {
		await add(key, value);
	});

prog
	.command("remove <key>")
	.describe("Remove a config key")
	.action(async (key: string) => {
		console.log(`Removing ${key}`);
		await remove(key);
		process.exit(0);
	});

prog
	.command("help")
	.describe("Show help information")
	.action(() => {
		prog.help();
		process.exit(0);
	});

async function clear() {
	await config.clear();
}

async function add(key: string, value: string) {
	if (!key || !value) {
		console.error("Key and value are required");
		process.exit(1);
	}
	await config.set(key as keyof typeof config.keysFromEnv, value);
}

async function remove(key: string) {
	if (!key) {
		console.error("Key is required");
		process.exit(1);
	}
	await config.delete(key as keyof typeof config.keysFromEnv);
}

// Parse arguments and handle help automatically
prog.parse(process.argv);
// process.exit(0);
