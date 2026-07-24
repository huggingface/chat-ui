import { dev } from "$app/environment";
import { base } from "$app/paths";
import { config } from "$lib/server/config";

function isLoopbackHost(hostname: string): boolean {
	return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function oauthCallbackUri(requestUrl: URL): string {
	const configured = config.PUBLIC_ORIGIN.trim();
	const originUrl = new URL(configured || requestUrl.origin);

	if (originUrl.username || originUrl.password || originUrl.search || originUrl.hash) {
		throw new Error("PUBLIC_ORIGIN must be an origin without credentials, query, or fragment");
	}
	if (originUrl.pathname !== "/") {
		throw new Error("PUBLIC_ORIGIN must not contain a path");
	}
	if (
		originUrl.protocol !== "https:" &&
		!(originUrl.protocol === "http:" && (dev || isLoopbackHost(originUrl.hostname)))
	) {
		throw new Error("OAuth callback origin must use HTTPS except on loopback");
	}

	return `${originUrl.origin}${base}/api/mcp/oauth/callback`;
}

export function oauthClientMetadataUri(requestUrl: URL): string {
	const callback = new URL(oauthCallbackUri(requestUrl));
	return `${callback.origin}${base}/api/mcp/oauth/client-metadata`;
}

export function safeLocalReturnPath(input: string | undefined): string {
	if (!input) return "/";
	try {
		const sentinel = new URL("https://chat-ui.invalid");
		const resolved = new URL(input, sentinel);
		if (resolved.origin !== sentinel.origin || resolved.username || resolved.password) {
			return "/";
		}
		return `${resolved.pathname}${resolved.search}`;
	} catch {
		return "/";
	}
}
