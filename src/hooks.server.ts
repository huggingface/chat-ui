import { dev } from "$app/environment";
import { COOKIE_NAME } from "$env/static/private";
import type { Handle } from "@sveltejs/kit";
import {
	PUBLIC_GOOGLE_ANALYTICS_ID,
	PUBLIC_DEPRECATED_GOOGLE_ANALYTICS_ID,
} from "$env/static/public";
import { addYears } from "date-fns";
import { collections } from "$lib/server/database";
import { base } from "$app/paths";
import { requiresUser } from "$lib/server/auth";

export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get(COOKIE_NAME);

	event.locals.sessionId = token || crypto.randomUUID();

	const user = await collections.users.findOne({ sessionId: event.locals.sessionId });

	if (user) {
		event.locals.userId = user._id;
	}

	if (
		!event.url.pathname.startsWith(`${base}/admin`) &&
		!["GET", "OPTIONS", "HEAD"].includes(event.request.method)
	) {
		const sendJson =
			event.request.headers.get("accept")?.includes("application/json") ||
			event.request.headers.get("content-type")?.includes("application/json");

		if (!user && requiresUser) {
			return new Response(
				sendJson
					? JSON.stringify({ error: "You need to be logged in first" })
					: "You need to be logged in first",
				{
					status: 401,
					headers: {
						"content-type": sendJson ? "application/json" : "text/plain",
					},
				}
			);
		}

		if (!event.url.pathname.startsWith(`${base}/settings`)) {
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

	// Refresh cookie expiration date
	event.cookies.set(COOKIE_NAME, event.locals.sessionId, {
		path: "/",
		// So that it works inside the space's iframe
		sameSite: dev ? "lax" : "none",
		secure: !dev,
		httpOnly: true,
		expires: addYears(new Date(), 1),
	});

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
