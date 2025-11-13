import { storage } from "./indexedDB";
import type { Settings } from "$lib/types/Settings";
import { DEFAULT_SETTINGS } from "$lib/types/Settings";
import type { StoredSettings } from "./types";

export async function getSettings(): Promise<Settings> {
	const stored = await storage.getSettings();
	if (!stored) {
		const defaultSettings: StoredSettings = {
			...DEFAULT_SETTINGS,
			id: "default",
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		await storage.saveSettings(defaultSettings);
		return defaultSettings;
	}
	return stored;
}

export async function saveSettings(settings: Settings): Promise<Settings> {
	const stored = await storage.saveSettings(settings);
	return stored;
}

