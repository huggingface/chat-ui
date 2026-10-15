import { config, ready } from "$lib/server/config";
import { base } from "$app/paths";
import { building } from "$app/environment";
import type { Handle, HandleServerError, ServerInit, HandleFetch } from "@sveltejs/kit";
import { initServer } from "$lib/server/hooks/init";
import { handleRequest } from "$lib/server/hooks/handle";
import { handleServerError } from "$lib/server/hooks/error";
import { handleFetchRequest } from "$lib/server/hooks/fetch";

export const init: ServerInit = async () => {
	if (building) return;
	return initServer();
};

export const handle: Handle = async (input) => {
	if (building) {
		// During static build, still replace %gaId% placeholder with empty string
		// to prevent the GA script from loading with an invalid ID
		return input.resolve(input.event, {
			transformPageChunk: ({ html }) => html.replace("%gaId%", ""),
		});
	}
	// Slack viewer routes have their own OIDC identity and per-thread authorization.
	// Do not turn a Slack browser session into a HuggingChat user session.
	if (input.event.url.pathname.startsWith(`${base}/slack/view/`)) {
		await ready;
		config.checkForUpdates();
		const resolved = await input.resolve(input.event);
		const response = new Response(resolved.body, {
			status: resolved.status,
			statusText: resolved.statusText,
			headers: resolved.headers,
		});
		response.headers.set("Cache-Control", "private, no-store");
		response.headers.set("Referrer-Policy", "no-referrer");
		response.headers.set("X-Content-Type-Options", "nosniff");
		response.headers.set("X-Frame-Options", "DENY");
		response.headers.set(
			"Content-Security-Policy",
			"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
		);
		return response;
	}
	return handleRequest(input);
};

export const handleError: HandleServerError = async (input) => {
	if (building) throw input.error;
	return handleServerError(input);
};

export const handleFetch: HandleFetch = async (input) => {
	if (building) return input.fetch(input.request);
	return handleFetchRequest(input);
};
