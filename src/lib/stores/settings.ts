import { browser } from "$app/environment";
import { base } from "$app/paths";
import { getContext, setContext } from "svelte";
import { type Writable, writable, get } from "svelte/store";

type SettingsStore = {
	shareConversationsWithModelAuthors: boolean;
	hideEmojiOnSidebar: boolean;
	ethicsModalAccepted: boolean;
	ethicsModalAcceptedAt: Date | null;
	activeModel: string;
	customPrompts: Record<string, string>;
};
export function useSettingsStore() {
	return getContext<Writable<SettingsStore>>("settings");
}
export function createSettingsStore(initialValue: SettingsStore) {
	const baseStore = writable(initialValue);
	let timeoutId: NodeJS.Timeout;

	async function setSettings(settings: Partial<SettingsStore>) {
		baseStore.update((s) => ({
			...s,
			...settings,
		}));

		clearTimeout(timeoutId);

		if (browser) {
			timeoutId = setTimeout(async () => {
				await fetch(`${base}/settings`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						...settings,
						...get(baseStore),
					}),
				});
			}, 300);

			// debounce server calls by 300ms
		}
	}

	const newStore = {
		subscribe: baseStore.subscribe,
		set: setSettings,
		update: (fn: (s: SettingsStore) => SettingsStore) => {
			setSettings(fn(get(baseStore)));
		},
	} satisfies Writable<SettingsStore>;

	setContext("settings", newStore);

	return newStore;
}
