import {
	ADMIN_API_SECRET,
	COOKIE_NAME,
	EXPOSE_API,
	MESSAGES_BEFORE_LOGIN,
	PARQUET_EXPORT_SECRET,
} from "$env/static/private";
import type { Handle } from "@sveltejs/kit";
import {
	PUBLIC_GOOGLE_ANALYTICS_ID,
	PUBLIC_ORIGIN,
	PUBLIC_APP_DISCLAIMER,
} from "$env/static/public";
import { collections } from "$lib/server/database";
import { base } from "$app/paths";
import { findUser, refreshSessionCookie, requiresUser } from "$lib/server/auth";
import { ERROR_MESSAGES } from "$lib/stores/errors";
import { sha256 } from "$lib/utils/sha256";
import { addWeeks } from "date-fns";

export const handle: Handle = async ({ event, resolve }) => {
	if (event.url.pathname.startsWith(`${base}/api/`) && EXPOSE_API !== "true") {
		return new Response("API is disabled", { status: 403 });
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

	if (event.url.pathname.startsWith(`${base}/admin/`) || event.url.pathname === `${base}/admin`) {
		const ADMIN_SECRET = ADMIN_API_SECRET || PARQUET_EXPORT_SECRET;

		if (!ADMIN_SECRET) {
			return errorResponse(500, "Admin API is not configured");
		}

		if (event.request.headers.get("Authorization") !== `Bearer ${ADMIN_SECRET}`) {
			return errorResponse(401, "Unauthorized");
		}
	}

	const token = event.cookies.get(COOKIE_NAME);

	let secretSessionId: string;
	let sessionId: string;

	if (token) {
		secretSessionId = token;
		sessionId = await sha256(token);

		const user = await findUser(sessionId);

		if (user) {
			event.locals.user = user;
		}
	} else {
		// if the user doesn't have any cookie, we generate one for him
		secretSessionId = crypto.randomUUID();
		sessionId = await sha256(secretSessionId);

		if (await collections.sessions.findOne({ sessionId })) {
			return errorResponse(500, "Session ID collision");
		}
	}

	event.locals.sessionId = sessionId;

	// CSRF protection
	const requestContentType = event.request.headers.get("content-type")?.split(";")[0] ?? "";
	/** https://developer.mozilla.org/en-US/docs/Web/HTML/Element/form#attr-enctype */
	const nativeFormContentTypes = [
		"multipart/form-data",
		"application/x-www-form-urlencoded",
		"text/plain",
	];

	if (event.request.method === "POST") {
		refreshSessionCookie(event.cookies, event.locals.sessionId);

		if (nativeFormContentTypes.includes(requestContentType)) {
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
	}

	if (event.request.method === "POST") {
		// if the request is a POST request we refresh the cookie
		refreshSessionCookie(event.cookies, secretSessionId);

		await collections.sessions.updateOne(
			{ sessionId },
			{ $set: { updatedAt: new Date(), expiresAt: addWeeks(new Date(), 2) } }
		);
	}

	if (
		!event.url.pathname.startsWith(`${base}/login`) &&
		!event.url.pathname.startsWith(`${base}/admin`) &&
		!["GET", "OPTIONS", "HEAD"].includes(event.request.method)
	) {
		if (
			!event.locals.user &&
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

	let replaced = false;

	const response = await resolve(event, {
		transformPageChunk: (chunk) => {
			// For some reason, Sveltekit doesn't let us load env variables from .env in the app.html template
			if (replaced || !chunk.html.includes("%gaId%")) {
				return chunk.html;
			}
			replaced = true;

			return chunk.html.replace("%gaId%", PUBLIC_GOOGLE_ANALYTICS_ID);
		},
	});

	return response;
};
