import { COOKIE_NAME, MESSAGES_BEFORE_LOGIN } from "$env/static/private";
import type { Handle } from "@sveltejs/kit";
import {
	PUBLIC_GOOGLE_ANALYTICS_ID,
	PUBLIC_DEPRECATED_GOOGLE_ANALYTICS_ID,
	PUBLIC_ORIGIN,
	PUBLIC_APP_DISCLAIMER,
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

	function errorResponse(status: number, message: string) {
		const sendJson =
			event.request.headers.get("accept")?.includes("application/json") ||
			event.request.headers.get("content-type")?.includes("application/json");
		return new Response(sendJson ? JSON.stringify({ error: message }) : message, {
			status,
			headers: {
				"content-type": sendJson ? "application/json" : "text/plain",
			},
		});
	}

	// CSRF protection
	const requestContentType = event.request.headers.get("content-type")?.split(";")[0] ?? "";
	/** https://developer.mozilla.org/en-US/docs/Web/HTML/Element/form#attr-enctype */
	const nativeFormContentTypes = [
		"multipart/form-data",
		"application/x-www-form-urlencoded",
		"text/plain",
	];
	if (event.request.method === "POST" && nativeFormContentTypes.includes(requestContentType)) {
		const referer = event.request.headers.get("referer");

		if (!referer) {
			return errorResponse(403, "Non-JSON form requests need to have a referer");
		}

		const validOrigins = [
			new URL(event.request.url).origin,
			...(PUBLIC_ORIGIN ? [new URL(PUBLIC_ORIGIN).origin] : []),
		];

		if (!validOrigins.includes(new URL(referer).origin)) {
			return errorResponse(403, "Invalid referer for POST request");
		}
	}

	if (
		!event.url.pathname.startsWith(`${base}/login`) &&
		!event.url.pathname.startsWith(`${base}/admin`) &&
		!["GET", "OPTIONS", "HEAD"].includes(event.request.method)
	) {
		if (
			!user &&
			requiresUser &&
			!((MESSAGES_BEFORE_LOGIN ? parseInt(MESSAGES_BEFORE_LOGIN) : 0) > 0)
		) {
			return errorResponse(401, ERROR_MESSAGES.authOnly);
		}

		// if login is not required and the call is not from /settings and we display the ethics modal with PUBLIC_APP_DISCLAIMER
		//  we check if the user has accepted the ethics modal first.
		// If login is required, `ethicsModalAcceptedAt` is already true at this point, so do not pass this condition. This saves a DB call.
		if (
			!requiresUser &&
			!event.url.pathname.startsWith(`${base}/settings`) &&
			!!PUBLIC_APP_DISCLAIMER
		) {
			const hasAcceptedEthicsModal = await collections.settings.countDocuments({
				sessionId: event.locals.sessionId,
				ethicsModalAcceptedAt: { $exists: true },
			});

			if (!hasAcceptedEthicsModal) {
				return errorResponse(405, "You need to accept the welcome modal first");
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
