import { browser } from "$app/environment";
import { invalidate } from "$app/navigation";
import { base } from "$app/paths";
import { UrlDependency } from "$lib/types/UrlDependency";
import { getContext, setContext } from "svelte";
import { type Writable, writable, get } from "svelte/store";

type SettingsStore = {
	shareConversationsWithModelAuthors: boolean;
	hideEmojiOnSidebar: boolean;
	ethicsModalAccepted: boolean;
	ethicsModalAcceptedAt: Date | null;
	activeModel: string;
	customPrompts: Record<string, string>;
	recentlySaved: boolean;
};
export function useSettingsStore() {
	return getContext<Writable<SettingsStore>>("settings");
}

export function createSettingsStore(initialValue: Omit<SettingsStore, "recentlySaved">) {
	const baseStore = writable({ ...initialValue, recentlySaved: false });

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
						...get(baseStore),
						...settings,
					}),
				});

				// set savedRecently to true for 3s
				baseStore.update((s) => ({
					...s,
					recentlySaved: true,
				}));
				setTimeout(() => {
					baseStore.update((s) => ({
						...s,
						recentlySaved: false,
					}));
				}, 3000);
				invalidate(UrlDependency.ConversationList);
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
