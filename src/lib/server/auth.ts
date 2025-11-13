import { config } from "$lib/server/config";
import { sha256 } from "$lib/utils/sha256";
import { dev } from "$app/environment";
import type { Cookies } from "@sveltejs/kit";
import { z } from "zod";
import type { Cookie } from "elysia";

const sameSite = z
	.enum(["lax", "none", "strict"])
	.default(dev || config.ALLOW_INSECURE_COOKIES === "true" ? "lax" : "none")
	.parse(config.COOKIE_SAMESITE === "" ? undefined : config.COOKIE_SAMESITE);

const secure = z
	.boolean()
	.default(!(dev || config.ALLOW_INSECURE_COOKIES === "true"))
	.parse(config.COOKIE_SECURE === "" ? undefined : config.COOKIE_SECURE === "true");

export function refreshSessionCookie(cookies: Cookies, sessionId: string) {
	cookies.set(config.COOKIE_NAME, sessionId, {
		path: "/",
		sameSite,
		secure,
		httpOnly: true,
	});
}

type CookieRecord =
	| { type: "elysia"; value: Record<string, Cookie<string | undefined>> }
	| { type: "svelte"; value: Cookies };
type HeaderRecord =
	| { type: "elysia"; value: Record<string, string | undefined> }
	| { type: "svelte"; value: Headers };

export async function authenticateRequest(
	headers: HeaderRecord,
	cookie: CookieRecord
): Promise<App.Locals & { secretSessionId: string }> {
	const token =
		cookie.type === "elysia"
			? cookie.value[config.COOKIE_NAME]?.value
			: cookie.value.get(config.COOKIE_NAME);

	let secretSessionId: string | null = null;
	let sessionId: string | null = null;

	if (token) {
		secretSessionId = token;
		sessionId = await sha256(token);
	} else {
		// Generate new session if none exists
		secretSessionId = crypto.randomUUID();
		sessionId = await sha256(secretSessionId);
	}

	return { sessionId, secretSessionId, isAdmin: false };
}

export const loginEnabled = false;

// Legacy function for backward compatibility - returns empty condition
export const authCondition = (_locals: App.Locals) => {
	return {};
};
