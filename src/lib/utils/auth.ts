import { goto } from "$app/navigation";
import { base } from "$app/paths";
import { page } from "$app/state";

/**
 * Redirects to the login page if the user is not authenticated
 * and the login feature is enabled.
 */
export function requireAuthUser(): boolean {
	if (page.data.loginEnabled && !page.data.user) {
		goto(`${base}/login`, { invalidateAll: true });
		return true;
	}
	return false;
}
