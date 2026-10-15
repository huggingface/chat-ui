import { writable } from "svelte/store";
export const loginInNewTab = writable(false);
import { goto } from "$app/navigation";
import { base } from "$app/paths";
import { page } from "$app/state";

/**
 * Redirects to the login page if the user is not authenticated
 * and the login feature is enabled.
 */
export function requireAuthUser(): boolean {
	if (page.data.loginEnabled && !page.data.user) {
		const next = page.url.pathname + page.url.search;
		const url = `${base}/login?next=${encodeURIComponent(next)}`;
		// OAuth must run outside an embedded Space: provider cookies may be
		// blocked in the iframe, causing sign-in redirect loops.
		if (window.self !== window.top && page.url.hostname.endsWith(".hf.space")) {
			window.open(new URL(url, page.url.origin).href, "_blank", "noopener,noreferrer");
			loginInNewTab.set(true);
		} else {
			goto(url, { invalidateAll: true });
		}
		return true;
	}
	return false;
}
