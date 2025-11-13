import { browser } from "$app/environment";
import { invalidate } from "$app/navigation";
import { base } from "$app/paths";
import { UrlDependency } from "$lib/types/UrlDependency";
import { getContext, setContext } from "svelte";
import { type Writable, writable, get } from "svelte/store";
import { saveSettings } from "$lib/storage/settings";

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
	securityApiEnabled: boolean;
	securityApiUrl: string;
	securityApiKey: string;
	llmApiUrl: string;
	llmApiKey: string;
};

type SettingsStoreWritable = Writable<SettingsStore> & {
	instantSet: (settings: Partial<SettingsStore>) => Promise<void>;
	initValue: <K extends keyof SettingsStore>(
		key: K,
		nestedKey: string,
		value: string | boolean
	) => Promise<void>;
};

export function useSettingsStore() {
	return getContext<SettingsStoreWritable>("settings");
}

export function createSettingsStore(initialValue: Omit<SettingsStore, "recentlySaved">) {
	const baseStore = writable({ ...initialValue, recentlySaved: false });

	let timeoutId: NodeJS.Timeout;
	let showSavedOnNextSync = false;

	async function setSettings(settings: Partial<SettingsStore>) {
		baseStore.update((s) => ({
			...s,
			...settings,
		}));

		if (browser) {
			showSavedOnNextSync = true; // User edit, should show "Saved"
			clearTimeout(timeoutId);
			timeoutId = setTimeout(async () => {
				try {
					const currentSettings = get(baseStore);
					await saveSettings({
						...currentSettings,
						welcomeModalSeenAt: currentSettings.welcomeModalSeen ? new Date() : null,
					});

					invalidate(UrlDependency.ConversationList);

					if (showSavedOnNextSync) {
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
					}

					showSavedOnNextSync = false;
				} catch (err) {
					console.error("Failed to save settings:", err);
				}
			}, 300);
			// debounce saves by 300ms
		}
	}

	async function initValue<K extends keyof SettingsStore>(
		key: K,
		nestedKey: string,
		value: string | boolean
	) {
		const currentStore = get(baseStore);
		const currentNestedObject = currentStore[key] as Record<string, string | boolean>;

		// Only initialize if undefined
		if (currentNestedObject?.[nestedKey] !== undefined) {
			return;
		}

		// Update the store
		const newNestedObject = {
			...(currentNestedObject || {}),
			[nestedKey]: value,
		};

		baseStore.update((s) => ({
			...s,
			[key]: newNestedObject,
		}));

		// Save to IndexedDB (debounced) - note: we don't set showSavedOnNextSync
		if (browser) {
			clearTimeout(timeoutId);
			timeoutId = setTimeout(async () => {
				try {
					const currentSettings = get(baseStore);
					await saveSettings({
						...currentSettings,
						welcomeModalSeenAt: currentSettings.welcomeModalSeen ? new Date() : null,
					});

					invalidate(UrlDependency.ConversationList);

					if (showSavedOnNextSync) {
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
					}

					showSavedOnNextSync = false;
				} catch (err) {
					console.error("Failed to save settings:", err);
				}
			}, 300);
		}
	}
	async function instantSet(settings: Partial<SettingsStore>) {
		baseStore.update((s) => ({
			...s,
			...settings,
		}));

		if (browser) {
			try {
				const currentSettings = get(baseStore);
				await saveSettings({
					...currentSettings,
					welcomeModalSeenAt: currentSettings.welcomeModalSeen ? new Date() : null,
				});
				invalidate(UrlDependency.ConversationList);
			} catch (err) {
				console.error("Failed to save settings:", err);
			}
		}
	}

	const newStore = {
		subscribe: baseStore.subscribe,
		set: setSettings,
		instantSet,
		initValue,
		update: (fn: (s: SettingsStore) => SettingsStore) => {
			setSettings(fn(get(baseStore)));
		},
	} satisfies SettingsStoreWritable;

	setContext("settings", newStore);

	return newStore;
}
