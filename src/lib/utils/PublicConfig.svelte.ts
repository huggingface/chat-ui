import type { env as publicEnv } from "$env/dynamic/public";
import { page } from "$app/state";
import { base } from "$app/paths";

import type { Transporter } from "@sveltejs/kit";
import { getContext } from "svelte";

type PublicConfigKey = keyof typeof publicEnv;

class PublicConfigManager {
	#configStore = $state<Record<PublicConfigKey, string>>({});

	constructor(initialConfig?: Record<PublicConfigKey, string>) {
		this.init = this.init.bind(this);
		this.getPublicConfig = this.getPublicConfig.bind(this);
		if (initialConfig) {
			this.init(initialConfig);
		}
	}

	init(publicConfig: Record<PublicConfigKey, string>) {
		this.#configStore = publicConfig;
	}

	get(key: PublicConfigKey) {
		return this.#configStore[key];
	}

	getPublicConfig() {
		return this.#configStore;
	}

	get isHuggingChat() {
		return this.#configStore.PUBLIC_APP_ASSETS === "huggingchat";
	}

	get assetPath() {
		return (
			(this.#configStore.PUBLIC_ORIGIN || page.url.origin) +
			base +
			"/" +
			this.#configStore.PUBLIC_APP_ASSETS
		);
	}
}
type ConfigProxy = PublicConfigManager & { [K in PublicConfigKey]: string };

export function getConfigManager(initialConfig?: Record<PublicConfigKey, string>) {
	const publicConfigManager = new PublicConfigManager(initialConfig);

	const publicConfig: ConfigProxy = new Proxy(publicConfigManager, {
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
	return publicConfig;
}

export const publicConfigTransporter: Transporter = {
	encode: (value) =>
		value instanceof PublicConfigManager ? JSON.stringify(value.getPublicConfig()) : false,
	decode: (value) => getConfigManager(JSON.parse(value)),
};

export const usePublicConfig = () => getContext<ConfigProxy>("publicConfig");
