import { env as publicEnv } from "$env/dynamic/public";
import { env as serverEnv } from "$env/dynamic/private";
import { collections } from "./database";
import { publicConfig } from "$lib/utils/PublicConfig.svelte";
import { building } from "$app/environment";

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

	get ConfigManagerEnabled() {
		return serverEnv.ENABLE_CONFIG_MANAGER === "true";
	}

	get(key: ConfigKey): string {
		if (!this.ConfigManagerEnabled) {
			return keysFromEnv[key] || "";
		}
		return this.keysFromDB[key] || keysFromEnv[key] || "";
	}

	async set(key: ConfigKey, value: string) {
		if (!this.ConfigManagerEnabled) throw new Error("Config manager is disabled");
		await collections.config.updateOne({ key }, { $set: { value } }, { upsert: true });
		this.keysFromDB[key] = value;
	}

	async delete(key: ConfigKey) {
		if (!this.ConfigManagerEnabled) throw new Error("Config manager is disabled");
		await collections.config.deleteOne({ key });
		delete this.keysFromDB[key];
	}

	async clear() {
		if (!this.ConfigManagerEnabled) throw new Error("Config manager is disabled");
		await collections.config.deleteMany({});
		this.keysFromDB = {};
	}

	getPublicConfig() {
		let config = {
			...Object.fromEntries(
				Object.entries(keysFromEnv).filter(([key]) => key.startsWith("PUBLIC_"))
			),
		} as Record<PublicConfigKey, string>;

		if (this.ConfigManagerEnabled) {
			config = {
				...config,
				...Object.fromEntries(
					Object.entries(this.keysFromDB).filter(([key]) => key.startsWith("PUBLIC_"))
				),
			};
		}
		return config;
	}

	get isHuggingChat() {
		return this.get("PUBLIC_APP_ASSETS") === "huggingchat";
	}

	async waitForInit() {
		while (!this.keysFromDB) {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
	}
}

// Create the instance and initialize it.
const configManager = new ConfigManager();

if (!building) {
	await configManager.init().then(() => {
		publicConfig.init(configManager.getPublicConfig());
	});
}

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
