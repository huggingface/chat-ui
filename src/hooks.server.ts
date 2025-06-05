import { config, ready } from "$lib/server/config";
import type { Handle, HandleServerError, ServerInit, HandleFetch } from "@sveltejs/kit";
import { collections } from "$lib/server/database";
import { base } from "$app/paths";
import { authenticateRequest, refreshSessionCookie, requiresUser } from "$lib/server/auth";
import { ERROR_MESSAGES } from "$lib/stores/errors";
import { addWeeks } from "date-fns";
import { checkAndRunMigrations } from "$lib/migrations/migrations";
import { building, dev } from "$app/environment";
import { logger } from "$lib/server/logger";
import { AbortedGenerations } from "$lib/server/abortedGenerations";
import { MetricsServer } from "$lib/server/metrics";
import { initExitHandler } from "$lib/server/exitHandler";
import { refreshAssistantsCounts } from "$lib/jobs/refresh-assistants-counts";
import { refreshConversationStats } from "$lib/jobs/refresh-conversation-stats";
import { adminTokenManager } from "$lib/server/adminToken";
import { isHostLocalhost } from "$lib/server/isURLLocal";

export const init: ServerInit = async () => {
	// Wait for config to be fully loaded
	await ready;

	// TODO: move this code on a started server hook, instead of using a "building" flag
	if (!building) {
		// Set HF_TOKEN as a process variable for Transformers.JS to see it
		process.env.HF_TOKEN ??= config.HF_TOKEN;

		logger.info("Starting server...");
		initExitHandler();

		checkAndRunMigrations();
		if (config.ENABLE_ASSISTANTS) {
			refreshAssistantsCounts();
		}
		refreshConversationStats();

		// Init metrics server
		MetricsServer.getInstance();

		// Init AbortedGenerations refresh process
		AbortedGenerations.getInstance();

		adminTokenManager.displayToken();

		if (config.EXPOSE_API) {
			logger.warn(
				"The EXPOSE_API flag has been deprecated. The API is now required for chat-ui to work."
			);
		}
	}
};

export const handleError: HandleServerError = async ({ error, event, status, message }) => {
	// handle 404

	if (building) {
		throw error;
	}

	if (event.route.id === null) {
		return {
			message: `Page ${event.url.pathname} not found`,
		};
	}

	const errorId = crypto.randomUUID();

	logger.error({
		locals: event.locals,
		url: event.request.url,
		params: event.params,
		request: event.request,
		message,
		error,
		errorId,
		status,
		stack: error instanceof Error ? error.stack : undefined,
	});

	return {
		message: "An error occurred",
		errorId,
	};
};

export const handle: Handle = async ({ event, resolve }) => {
	await ready.then(() => {
		config.checkForUpdates();
	});

	logger.debug({
		locals: event.locals,
		url: event.url.pathname,
		params: event.params,
		request: event.request,
	});

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
		const ADMIN_SECRET = config.ADMIN_API_SECRET || config.PARQUET_EXPORT_SECRET;

		if (!ADMIN_SECRET) {
			return errorResponse(500, "Admin API is not configured");
		}

		if (event.request.headers.get("Authorization") !== `Bearer ${ADMIN_SECRET}`) {
			return errorResponse(401, "Unauthorized");
		}
	}

	const auth = await authenticateRequest(
		{ type: "svelte", value: event.request.headers },
		{ type: "svelte", value: event.cookies }
	);

	event.locals.user = auth.user || undefined;
	event.locals.sessionId = auth.sessionId;

	event.locals.isAdmin =
		event.locals.user?.isAdmin || adminTokenManager.isAdmin(event.locals.sessionId);

	// CSRF protection
	const requestContentType = event.request.headers.get("content-type")?.split(";")[0] ?? "";
	/** https://developer.mozilla.org/en-US/docs/Web/HTML/Element/form#attr-enctype */
	const nativeFormContentTypes = [
		"multipart/form-data",
		"application/x-www-form-urlencoded",
		"text/plain",
	];

	if (event.request.method === "POST") {
		if (nativeFormContentTypes.includes(requestContentType)) {
			const origin = event.request.headers.get("origin");

			if (!origin) {
				return errorResponse(403, "Non-JSON form requests need to have an origin");
			}

			const validOrigins = [
				new URL(event.request.url).host,
				...(config.PUBLIC_ORIGIN ? [new URL(config.PUBLIC_ORIGIN).host] : []),
			];

			if (!validOrigins.includes(new URL(origin).host)) {
				return errorResponse(403, "Invalid referer for POST request");
			}
		}
	}

	if (
		event.request.method === "POST" ||
		event.url.pathname.startsWith(`${base}/login`) ||
		event.url.pathname.startsWith(`${base}/login/callback`)
	) {
		// if the request is a POST request or login-related we refresh the cookie
		refreshSessionCookie(event.cookies, auth.secretSessionId);

		await collections.sessions.updateOne(
			{ sessionId: auth.sessionId },
			{ $set: { updatedAt: new Date(), expiresAt: addWeeks(new Date(), 2) } }
		);
	}

	if (
		!event.url.pathname.startsWith(`${base}/login`) &&
		!event.url.pathname.startsWith(`${base}/admin`) &&
		!event.url.pathname.startsWith(`${base}/settings`) &&
		!["GET", "OPTIONS", "HEAD"].includes(event.request.method)
	) {
		if (
			!event.locals.user &&
			requiresUser &&
			!((config.MESSAGES_BEFORE_LOGIN ? parseInt(config.MESSAGES_BEFORE_LOGIN) : 0) > 0)
		) {
			return errorResponse(401, ERROR_MESSAGES.authOnly);
		}

		// if login is not required and the call is not from /settings and we display the ethics modal with PUBLIC_APP_DISCLAIMER
		//  we check if the user has accepted the ethics modal first.
		// If login is required, `ethicsModalAcceptedAt` is already true at this point, so do not pass this condition. This saves a DB call.
		if (
			!requiresUser &&
			!event.url.pathname.startsWith(`${base}/settings`) &&
			config.PUBLIC_APP_DISCLAIMER === "1"
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

			return chunk.html.replace("%gaId%", config.PUBLIC_GOOGLE_ANALYTICS_ID);
		},
		filterSerializedResponseHeaders: (header) => {
			return header.includes("content-type");
		},
	});

	// Add CSP header to disallow framing if ALLOW_IFRAME is not "true"
	if (config.ALLOW_IFRAME !== "true") {
		response.headers.append("Content-Security-Policy", "frame-ancestors 'none';");
	}

	if (
		event.url.pathname.startsWith(`${base}/login/callback`) ||
		event.url.pathname.startsWith(`${base}/login`)
	) {
		response.headers.append("Cache-Control", "no-store");
	}

	if (event.url.pathname.startsWith(`${base}/api/`)) {
		// get origin from the request
		const requestOrigin = event.request.headers.get("origin");

		// get origin from the config if its defined
		let allowedOrigin = config.PUBLIC_ORIGIN ? new URL(config.PUBLIC_ORIGIN).origin : undefined;

		if (
			dev || // if we're in dev mode
			!requestOrigin || // or the origin is null (SSR)
			isHostLocalhost(new URL(requestOrigin).hostname) // or the origin is localhost
		) {
			allowedOrigin = "*"; // allow all origins
		} else if (allowedOrigin === requestOrigin) {
			allowedOrigin = requestOrigin; // echo back the caller
		}

		if (allowedOrigin) {
			response.headers.set("Access-Control-Allow-Origin", allowedOrigin);
			response.headers.set(
				"Access-Control-Allow-Methods",
				"GET, POST, PUT, PATCH, DELETE, OPTIONS"
			);
			response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
		}
	}
	return response;
};

export const handleFetch: HandleFetch = async ({ event, request, fetch }) => {
	if (isHostLocalhost(new URL(request.url).hostname)) {
		const cookieHeader = event.request.headers.get("cookie");
		if (cookieHeader) {
			const headers = new Headers(request.headers);
			headers.set("cookie", cookieHeader);

			return fetch(new Request(request, { headers }));
		}
	}

	return fetch(request);
};
