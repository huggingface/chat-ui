import { COOKIE_NAME } from "$env/static/private";
import type { Handle } from "@sveltejs/kit";
import {
	PUBLIC_GOOGLE_ANALYTICS_ID,
	PUBLIC_DEPRECATED_GOOGLE_ANALYTICS_ID,
} from "$env/static/public";
import { collections } from "$lib/server/database";
import { base } from "$app/paths";
import { refreshSessionCookie, requiresUser } from "$lib/server/auth";
import { ERROR_MESSAGES } from "$lib/stores/errors";

export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get(COOKIE_NAME);

	event.locals.sessionId = token || crypto.randomUUID();

	const user = await collections.users.findOne({ sessionId: event.locals.sessionId });

	if (user) {
		event.locals.user = user;
	}

	if (
		!event.url.pathname.startsWith(`${base}/login`) &&
		!event.url.pathname.startsWith(`${base}/admin`) &&
		!["GET", "OPTIONS", "HEAD"].includes(event.request.method)
	) {
		const sendJson =
			event.request.headers.get("accept")?.includes("application/json") ||
			event.request.headers.get("content-type")?.includes("application/json");

		if (!user && requiresUser) {
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

		// if login is not required and the call is not from /settings, we check if the user has accepted the ethics modal first.
		// If login is required, `ethicsModalAcceptedAt` is already true at this point, so do not pass this condition. This saves a DB call.
		if (!requiresUser && !event.url.pathname.startsWith(`${base}/settings`)) {
			const hasAcceptedEthicsModal = await collections.settings.countDocuments({
				sessionId: event.locals.sessionId,
				ethicsModalAcceptedAt: { $exists: true },
			});

			if (!hasAcceptedEthicsModal) {
				return new Response(
					sendJson
						? JSON.stringify({ error: "You need to accept the welcome modal first" })
						: "You need to accept the welcome modal first",
					{
						status: 405,
						headers: {
							"content-type": sendJson ? "application/json" : "text/plain",
						},
					}
				);
			}
		}
	}

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
