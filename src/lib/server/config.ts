import { env as publicEnv } from "$env/dynamic/public";
import { env as serverEnv } from "$env/dynamic/private";
import { collections } from "./database";
import { publicConfig } from "$lib/utils/PublicConfig.svelte";
import { logger } from "$lib/server/logger";

export type PublicConfigKey = keyof typeof publicEnv;

const keysFromEnv = { ...publicEnv, ...serverEnv };
export type ConfigKey = keyof typeof keysFromEnv;

class ConfigManager {
	private keysFromDB: Partial<Record<ConfigKey, string>> = {};

	async init() {
		const configs = await collections.config.find({}).toArray();
		this.keysFromDB = configs.reduce(
			(acc, curr) => {
				acc[curr.key as ConfigKey] = curr.value;
				return acc;
			},
			{} as Record<ConfigKey, string>
		);
	}

	get(key: ConfigKey): string {
		return this.keysFromDB[key] || keysFromEnv[key] || "";
	}

	async set(key: ConfigKey, value: string) {
		await collections.config.updateOne({ key }, { $set: { value } }, { upsert: true });
		this.keysFromDB[key] = value;
	}

	async delete(key: ConfigKey) {
		await collections.config.deleteOne({ key });
		delete this.keysFromDB[key];
	}

	async clear() {
		await collections.config.deleteMany({});
		this.keysFromDB = {};
	}

	getPublicConfig() {
		return {
			...Object.fromEntries(
				Object.entries(keysFromEnv).filter(([key]) => key.startsWith("PUBLIC_"))
			),
			...Object.fromEntries(
				Object.entries(this.keysFromDB).filter(([key]) => key.startsWith("PUBLIC_"))
			),
		} as Record<PublicConfigKey, string>;
	}

	get isHuggingChat() {
		return this.get("PUBLIC_APP_ASSETS") === "huggingchat";
	}
}

// Create the instance and initialize it.
const configManager = new ConfigManager();

await configManager.init().then(() => {
	logger.info(configManager.getPublicConfig(), "config manager");
	publicConfig.init(configManager.getPublicConfig());
});

type ConfigProxy = ConfigManager & { [K in ConfigKey]: string };

export const config: ConfigProxy = new Proxy(configManager, {
	get(target, prop, receiver) {
		if (prop in target) {
			return Reflect.get(target, prop, receiver);
		}
		if (typeof prop === "string") {
			return target.get(prop as ConfigKey);
		}
		return undefined;
	},
	set(target, prop, value, receiver) {
		if (prop in target) {
			return Reflect.set(target, prop, value, receiver);
		}
		if (typeof prop === "string") {
			target.set(prop as ConfigKey, value);
			return true;
		}
		return false;
	},
}) as ConfigProxy;
