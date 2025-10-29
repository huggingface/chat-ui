import { goto } from "$app/navigation";
import { base } from "$app/paths";
import { page } from "$app/state";

/**
 * Redirects to the login page if the user is not authenticated
 * and the login feature is enabled.
 */
export function requireAuthUser(): boolean {
	if (page.data.loginEnabled && !page.data.user) {
		const url = page.data.shared
			? `${base}/login?next=${encodeURIComponent(page.url.pathname + page.url.search)}`
			: `${base}/login`;
		goto(url, { invalidateAll: true });
		return true;
	}
	return false;
}
