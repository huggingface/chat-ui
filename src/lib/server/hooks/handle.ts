import type { Handle, RequestEvent } from "@sveltejs/kit";
import { collections } from "$lib/server/database";
import { base } from "$app/paths";
import { dev } from "$app/environment";
import {
	authenticateRequest,
	loginEnabled,
	refreshSessionCookie,
	triggerOauthFlow,
} from "$lib/server/auth";
import { ERROR_MESSAGES } from "$lib/stores/errors";
import { addWeeks } from "date-fns";
import { logger } from "$lib/server/logger";
import { adminTokenManager } from "$lib/server/adminToken";
import { isHostLocalhost } from "$lib/server/isURLLocal";
import { runWithRequestContext, updateRequestContext } from "$lib/server/requestContext";
import { config, ready } from "$lib/server/config";

type HandleInput = Parameters<Handle>[0];

function getClientAddressSafe(event: RequestEvent): string | undefined {
	try {
		return event.getClientAddress();
	} catch {
		return undefined;
	}
}

function getAllowedOrigin(requestOrigin: string | null): string | undefined {
	let allowedOrigin = config.PUBLIC_ORIGIN ? new URL(config.PUBLIC_ORIGIN).origin : undefined;

	if (dev || !requestOrigin || isHostLocalhost(new URL(requestOrigin).hostname)) {
		allowedOrigin = "*";
	} else if (requestOrigin.startsWith("capacitor://")) {
		allowedOrigin = requestOrigin;
	} else if (allowedOrigin === requestOrigin) {
		allowedOrigin = requestOrigin;
	}

	return allowedOrigin;
}

export async function handleRequest({ event, resolve }: HandleInput): Promise<Response> {
	// Generate a unique request ID for this request
	const requestId = crypto.randomUUID();

	// Run the entire request handling within the request context
	return runWithRequestContext(
		async () => {
			// Handle OPTIONS preflight requests for CORS
			if (event.request.method === "OPTIONS" && event.url.pathname.startsWith(`${base}/api/`)) {
				const requestOrigin = event.request.headers.get("origin");
				const allowed = getAllowedOrigin(requestOrigin);
				return new Response(null, {
					status: 204,
					headers: {
						...(allowed ? { "Access-Control-Allow-Origin": allowed } : {}),
						"Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
						"Access-Control-Allow-Headers": "Content-Type, Authorization",
						"Access-Control-Allow-Credentials": "true",
						"Access-Control-Max-Age": "86400",
					},
				});
			}

			await ready.then(() => {
				config.checkForUpdates();
			});

			logger.debug(
				{
					locals: event.locals,
					url: event.url.pathname,
					params: event.params,
					request: event.request,
				},
				"Request received"
			);

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

			if (
				event.url.pathname.startsWith(`${base}/admin/`) ||
				event.url.pathname === `${base}/admin`
			) {
				const ADMIN_SECRET = config.ADMIN_API_SECRET || config.PARQUET_EXPORT_SECRET;

				if (!ADMIN_SECRET) {
					return errorResponse(500, "Admin API is not configured");
				}

				if (event.request.headers.get("Authorization") !== `Bearer ${ADMIN_SECRET}`) {
					return errorResponse(401, "Unauthorized");
				}
			}

			const isApi = event.url.pathname.startsWith(`${base}/api/`);
			const auth = await authenticateRequest(
				event.request.headers,
				event.cookies,
				event.url,
				isApi
			);

			event.locals.sessionId = auth.sessionId;

			if (loginEnabled && !auth.user && !event.url.pathname.startsWith(`${base}/.well-known/`)) {
				if (config.AUTOMATIC_LOGIN === "true") {
					// AUTOMATIC_LOGIN: always redirect to OAuth flow (unless already on login or healthcheck pages)
					if (
						!event.url.pathname.startsWith(`${base}/login`) &&
						!event.url.pathname.startsWith(`${base}/healthcheck`)
					) {
						// To get the same CSRF token after callback
						refreshSessionCookie(event.cookies, auth.secretSessionId);
						return await triggerOauthFlow(event);
					}
				} else {
					// Redirect to OAuth flow unless on the authorized pages (home, shared conversation, login, healthcheck, model thumbnails)
					if (
						event.url.pathname !== `${base}/` &&
						event.url.pathname !== `${base}` &&
						!event.url.pathname.startsWith(`${base}/login`) &&
						!event.url.pathname.startsWith(`${base}/login/callback`) &&
						!event.url.pathname.startsWith(`${base}/healthcheck`) &&
						!event.url.pathname.startsWith(`${base}/r/`) &&
						!event.url.pathname.startsWith(`${base}/conversation/`) &&
						!event.url.pathname.startsWith(`${base}/models/`) &&
						!event.url.pathname.startsWith(`${base}/api`)
					) {
						refreshSessionCookie(event.cookies, auth.secretSessionId);
						return triggerOauthFlow(event);
					}
				}
			}

			event.locals.user = auth.user || undefined;
			event.locals.token = auth.token;

			// Update request context with user after authentication
			if (auth.user?.username) {
				updateRequestContext({ user: auth.user.username });
			}

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
				loginEnabled &&
				!event.locals.user &&
				!event.url.pathname.startsWith(`${base}/login`) &&
				!event.url.pathname.startsWith(`${base}/admin`) &&
				!event.url.pathname.startsWith(`${base}/settings`) &&
				!["GET", "OPTIONS", "HEAD"].includes(event.request.method)
			) {
				return errorResponse(401, ERROR_MESSAGES.authOnly);
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

			// Update request context with status code
			updateRequestContext({ statusCode: response.status });

			// Add CSP header to control iframe embedding
			// Always allow huggingface.co; when ALLOW_IFRAME=true, allow all domains
			if (config.ALLOW_IFRAME !== "true") {
				response.headers.append(
					"Content-Security-Policy",
					"frame-ancestors https://huggingface.co;"
				);
			}

			if (
				event.url.pathname.startsWith(`${base}/login/callback`) ||
				event.url.pathname.startsWith(`${base}/login`)
			) {
				response.headers.append("Cache-Control", "no-store");
			}

			if (event.url.pathname.startsWith(`${base}/api/`)) {
				const requestOrigin = event.request.headers.get("origin");
				const allowedOrigin = getAllowedOrigin(requestOrigin);

				if (allowedOrigin) {
					response.headers.set("Access-Control-Allow-Origin", allowedOrigin);
					response.headers.set(
						"Access-Control-Allow-Methods",
						"GET, POST, PUT, PATCH, DELETE, OPTIONS"
					);
					response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
					response.headers.set("Access-Control-Allow-Credentials", "true");
				}
			}

			logger.info("Request completed");

			return response;
		},
		{ requestId, url: event.url.pathname, ip: getClientAddressSafe(event) }
	);
}
