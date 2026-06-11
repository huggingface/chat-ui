/**
 * Parse an untrusted href (e.g. forwarded via postMessage from a sandboxed
 * artifact preview) into a URL that is safe to open in a new tab. Only
 * absolute http(s) URLs survive; anything else (javascript:, data:, relative,
 * malformed) returns undefined. URLs with embedded credentials are rejected
 * too: `https://trusted.com@evil.com` is a phishing classic, and userinfo
 * breaks the guarantee that the confirm dialog renders exactly what opens.
 */
export function parseExternalUrl(href: unknown): URL | undefined {
	if (typeof href !== "string") return undefined;
	let url: URL;
	try {
		url = new URL(href);
	} catch {
		return undefined;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
	if (url.username || url.password) return undefined;
	return url;
}
