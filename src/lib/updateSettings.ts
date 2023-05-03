import { invalidate } from "$app/navigation";
import { base } from "$app/paths";
import { error } from "$lib/stores/errors";
import type { Settings } from "./types/Settings";
import { UrlDependency } from "./types/UrlDependency";

export async function updateSettings(
	settings: Partial<
		Omit<Settings, "sessionId" | "ethicsModalAcceptedAt"> & { ethicsModalAccepted?: boolean }
	>
): Promise<boolean> {
	try {
		const res = await fetch(`${base}/settings`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(settings),
		});
		if (!res.ok) {
			error.set("Error while updating settings, try again.");
			return false;
		}
		await invalidate(UrlDependency.Settings);
		return true;
	} catch (err) {
		console.error(err);
		error.set(String(err));
		return false;
	}
}
