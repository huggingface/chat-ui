import { COOKIE_NAME } from "$env/static/private";
import type { Handle } from "@sveltejs/kit";
import {
	PUBLIC_GOOGLE_ANALYTICS_ID,
	PUBLIC_DEPRECATED_GOOGLE_ANALYTICS_ID,
} from "$env/static/public";
import { collections } from "$lib/server/database";
import { base } from "$app/paths";
import { refreshSessionCookie, requiresUser } from "$lib/server/auth";
import { sequence } from "@sveltejs/kit/hooks";
import { ERROR_MESSAGES } from "$lib/stores/errors";

const authorization: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get(COOKIE_NAME);

	event.locals.sessionId = token || crypto.randomUUID();

	const user = await collections.users.findOne({ sessionId: event.locals.sessionId });

	if (user?.hfUserId) {
		event.locals.userId = user._id;
	}

	if (
		!event.url.pathname.startsWith(`${base}/login`) &&
		!event.url.pathname.startsWith(`${base}/admin`) &&
		!["GET", "OPTIONS", "HEAD"].includes(event.request.method)
	) {
		const sendJson =
			event.request.headers.get("accept")?.includes("application/json") ||
			event.request.headers.get("content-type")?.includes("application/json");

		if (!user?.hfUserId && requiresUser) {
			return new Response(
				sendJson ? JSON.stringify({ error: ERROR_MESSAGES.authOnly }) : ERROR_MESSAGES.authOnly,
				{
					status: 401,
					headers: {
						"content-type": sendJson ? "application/json" : "text/plain",
					},
				}
			);
		}
	}

	// Refresh cookie expiration date
	refreshSessionCookie(event.cookies, event.locals.sessionId);

	let replaced = false;

	const response = await resolve(event, {
		transformPageChunk: (chunk) => {
			// For some reason, Sveltekit doesn't let us load env variables from .env in the app.html template
			if (replaced || !chunk.html.includes("%gaId%") || !chunk.html.includes("%gaIdDeprecated%")) {
				return chunk.html;
			}
			replaced = true;

			return chunk.html
				.replace("%gaId%", PUBLIC_GOOGLE_ANALYTICS_ID)
				.replace("%gaIdDeprecated%", PUBLIC_DEPRECATED_GOOGLE_ANALYTICS_ID);
		},
	});

	return response;
};

export const handle: Handle = sequence(authorization);
