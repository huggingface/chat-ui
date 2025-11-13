import { config, ready } from "$lib/server/config";
import type { Handle, HandleServerError, ServerInit, HandleFetch } from "@sveltejs/kit";
import { base } from "$app/paths";
import { authenticateRequest, refreshSessionCookie } from "$lib/server/auth";
import { building, dev } from "$app/environment";
import { logger } from "$lib/server/logger";
import { initExitHandler } from "$lib/server/exitHandler";
import { isHostLocalhost } from "$lib/server/isURLLocal";
import { MetricsServer } from "$lib/server/metrics";

export const init: ServerInit = async () => {
	// Wait for config to be fully loaded
	await ready;

	// TODO: move this code on a started server hook, instead of using a "building" flag
	if (!building) {
		logger.info("Starting server...");
		initExitHandler();

		if (config.METRICS_ENABLED === "true") {
			MetricsServer.getInstance();
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

	const auth = await authenticateRequest(
		{ type: "svelte", value: event.request.headers },
		{ type: "svelte", value: event.cookies }
	);

	event.locals.sessionId = auth.sessionId;
	event.locals.isAdmin = false;

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

	if (event.request.method === "POST") {
		// Refresh the cookie on POST requests
		refreshSessionCookie(event.cookies, auth.secretSessionId);
	}

	// const replaced = false; // Unused, kept for future use

	const response = await resolve(event, {
		transformPageChunk: (chunk) => {
			return chunk.html;
		},
		filterSerializedResponseHeaders: (header) => {
			return header.includes("content-type");
		},
	});

	// Add CSP header to disallow framing if ALLOW_IFRAME is not "true"
	if (config.ALLOW_IFRAME !== "true") {
		response.headers.append("Content-Security-Policy", "frame-ancestors 'none';");
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
