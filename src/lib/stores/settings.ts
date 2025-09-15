import { browser } from "$app/environment";
import { invalidate } from "$app/navigation";
import { base } from "$app/paths";
import { UrlDependency } from "$lib/types/UrlDependency";
import { getContext, setContext } from "svelte";
import { type Writable, writable, get } from "svelte/store";

type SettingsStore = {
	shareConversationsWithModelAuthors: boolean;
	welcomeModalSeen: boolean;
	welcomeModalSeenAt: Date | null;
	activeModel: string;
	customPrompts: Record<string, string>;
	multimodalOverrides: Record<string, boolean>;
	recentlySaved: boolean;
	disableStream: boolean;
	directPaste: boolean;
	hidePromptExamples: Record<string, boolean>;
};

type SettingsStoreWritable = Writable<SettingsStore> & {
	instantSet: (settings: Partial<SettingsStore>) => Promise<void>;
};

export function useSettingsStore() {
	return getContext<SettingsStoreWritable>("settings");
}

export function createSettingsStore(initialValue: Omit<SettingsStore, "recentlySaved">) {
	const baseStore = writable({ ...initialValue, recentlySaved: false });

	let timeoutId: NodeJS.Timeout;

	async function setSettings(settings: Partial<SettingsStore>) {
		baseStore.update((s) => ({
			...s,
			...settings,
		}));

		if (browser) {
			clearTimeout(timeoutId);
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

				invalidate(UrlDependency.ConversationList);
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
			}, 300);
			// debounce server calls by 300ms
		}
	}
	async function instantSet(settings: Partial<SettingsStore>) {
		baseStore.update((s) => ({
			...s,
			...settings,
		}));

		if (browser) {
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
			invalidate(UrlDependency.ConversationList);
		}
	}

	const newStore = {
		subscribe: baseStore.subscribe,
		set: setSettings,
		instantSet,
		update: (fn: (s: SettingsStore) => SettingsStore) => {
			setSettings(fn(get(baseStore)));
		},
	} satisfies SettingsStoreWritable;

	setContext("settings", newStore);

	return newStore;
}
