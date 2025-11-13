import { env as publicEnv } from "$env/dynamic/public";
import { env as serverEnv } from "$env/dynamic/private";
import { building } from "$app/environment";
import type { ConfigKey as ConfigKeyType } from "$lib/types/ConfigKey";
import type { Semaphore } from "$lib/types/Semaphore";
import { Semaphores } from "$lib/types/Semaphore";

export type PublicConfigKey = keyof typeof publicEnv;
const keysFromEnv = { ...publicEnv, ...serverEnv };
export type ConfigKey = keyof typeof keysFromEnv;

class ConfigManager {
	private keysFromDB: Partial<Record<ConfigKey, string>> = {};
	private isInitialized = false;

	private lastConfigUpdate: Date | undefined;

	async init() {
		if (this.isInitialized) return;

		if (import.meta.env.MODE === "test") {
			this.isInitialized = true;
			return;
		}

		// Config manager disabled - MongoDB removed
		// Configuration is now managed via environment variables only
		this.isInitialized = true;
	}

	get ConfigManagerEnabled() {
		// Config manager disabled - MongoDB removed
		return false;
	}

	get isHuggingChat() {
		return this.get("PUBLIC_APP_ASSETS") === "huggingchat";
	}

	async checkForUpdates() {
		if (await this.isConfigStale()) {
			await this.updateConfig();
		}
	}

	async isConfigStale(): Promise<boolean> {
		// Config manager disabled - always return false
		return false;
	}

	async updateConfig() {
		// Config manager disabled - no database updates
		this.keysFromDB = {};
		this.lastConfigUpdate = new Date();
	}

	get(key: ConfigKey): string {
		if (!this.ConfigManagerEnabled) {
			return keysFromEnv[key] || "";
		}
		return this.keysFromDB[key] || keysFromEnv[key] || "";
	}

	async updateSemaphore() {
		// Config manager disabled - no database updates
	}

	async set(key: ConfigKey, value: string) {
		if (!this.ConfigManagerEnabled) throw new Error("Config manager is disabled");
		this.keysFromDB[key] = value;
	}

	async delete(key: ConfigKey) {
		if (!this.ConfigManagerEnabled) throw new Error("Config manager is disabled");
		delete this.keysFromDB[key];
	}

	async clear() {
		if (!this.ConfigManagerEnabled) throw new Error("Config manager is disabled");
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

		const publicEnvKeys = Object.keys(publicEnv);

		return Object.fromEntries(
			Object.entries(config).filter(([key]) => publicEnvKeys.includes(key))
		) as Record<PublicConfigKey, string>;
	}
}

// Create the instance and initialize it.
const configManager = new ConfigManager();

export const ready = (async () => {
	if (!building) {
		await configManager.init();
	}
})();

type ExtraConfigKeys = "OLD_MODELS" | "ENABLE_ASSISTANTS" | "METRICS_ENABLED" | "METRICS_PORT";

type ConfigProxy = ConfigManager & { [K in ConfigKey | ExtraConfigKeys]: string };

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
