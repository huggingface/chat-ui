import { goto } from "$app/navigation";
import { base } from "$app/paths";
import { page } from "$app/state";

const AUTH_RECOVERY_KEY = "chatui_auth_recovery_state";
const AUTH_RECOVERY_WINDOW_MS = 60_000;

/**
 * Redirects to the login page if the user is not authenticated
 * and the login feature is enabled.
 */
export function requireAuthUser(): boolean {
	if (page.data.loginEnabled && !page.data.user) {
		const url =
			page.data.shared || page.url.pathname.startsWith(`${base}/models/`)
				? `${base}/login?next=${encodeURIComponent(page.url.pathname + page.url.search)}`
				: `${base}/login`;
		goto(url, { invalidateAll: true });
		return true;
	}
	return false;
}

export function isAuthFailureMessage(message?: string): boolean {
	const value = (message ?? "").toLowerCase();
	return (
		value.includes("401") ||
		value.includes("unauthorized") ||
		value.includes("not authenticated") ||
		value.includes("auth only") ||
		value.includes("must have a valid session")
	);
}

export function resetAuthRecoveryState(): void {
	if (typeof window === "undefined") return;
	window.sessionStorage.removeItem(AUTH_RECOVERY_KEY);
}

export async function triggerAuthRecovery(opts?: {
	basePath?: string;
	reason?: string;
}): Promise<void> {
	if (typeof window === "undefined") return;

	const basePath = opts?.basePath ?? base;
	const reason = opts?.reason ?? "auth_error";

	await fetch(`${basePath}/logout`, { method: "POST" }).catch(() => {});

	// If embedded, notify host app so it can decide how to reload parent/iframe.
	try {
		if (window.parent && window.parent !== window) {
			window.parent.postMessage(
				{
					type: "chatui.auth.error",
					action: "reload_or_reauth",
					reason,
					at: Date.now(),
				},
				"*"
			);
		}
	} catch {
		// noop
	}

	let count = 0;
	let ts = 0;
	try {
		const raw = window.sessionStorage.getItem(AUTH_RECOVERY_KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as { count?: number; ts?: number };
			count = Number(parsed.count ?? 0);
			ts = Number(parsed.ts ?? 0);
		}
	} catch {
		// noop
	}

	const now = Date.now();
	const isWithinWindow = now - ts <= AUTH_RECOVERY_WINDOW_MS;
	const nextCount = isWithinWindow ? count + 1 : 1;
	window.sessionStorage.setItem(
		AUTH_RECOVERY_KEY,
		JSON.stringify({
			count: nextCount,
			ts: now,
		})
	);

	const next = encodeURIComponent(window.location.pathname + window.location.search);
	const loginUrl = `${basePath}/login?next=${next}`;

	// First hit: soft recovery via reload; repeated hit: force re-login.
	if (nextCount === 1) {
		window.location.reload();
		return;
	}

	window.location.href = loginUrl;
}
