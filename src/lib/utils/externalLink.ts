/**
 * Parse an untrusted href (e.g. forwarded via postMessage from a sandboxed
 * artifact preview) into a URL that is safe to open in a new tab. Only
 * absolute http(s) URLs survive; anything else (javascript:, data:, relative,
 * malformed) returns undefined.
 */
export function parseExternalUrl(href: unknown): URL | undefined {
	if (typeof href !== "string") return undefined;
	let url: URL;
	try {
		url = new URL(href);
	} catch {
		return undefined;
	}
	return url.protocol === "http:" || url.protocol === "https:" ? url : undefined;
}
