import type { env as publicEnv } from "$env/dynamic/public";

type PublicConfigKey = keyof typeof publicEnv;

class PublicConfigManager {
	#configStore = $state<Record<PublicConfigKey, string>>({});

	constructor() {
		this.init = this.init.bind(this);
	}

	init(publicConfig: Record<PublicConfigKey, string>) {
		this.#configStore = publicConfig;
	}

	get(key: PublicConfigKey) {
		return this.#configStore[key];
	}

	get isHuggingChat() {
		return this.#configStore.PUBLIC_APP_ASSETS === "huggingchat";
	}
}

const publicConfigManager = new PublicConfigManager();

type ConfigProxy = PublicConfigManager & { [K in PublicConfigKey]: string };

export const publicConfig: ConfigProxy = new Proxy(publicConfigManager, {
	get(target, prop) {
		if (prop in target) {
			return Reflect.get(target, prop);
		}
		if (typeof prop === "string") {
			return target.get(prop as PublicConfigKey);
		}
		return undefined;
	},
	set(target, prop, value, receiver) {
		if (prop in target) {
			return Reflect.set(target, prop, value, receiver);
		}
		return false;
	},
}) as ConfigProxy;
