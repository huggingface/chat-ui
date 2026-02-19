import { Agent, fetch } from "undici";
import { isValidUrl, assertSafeIp } from "$lib/server/urlSafety";
import dns from "node:dns";
import { logger } from "$lib/server/logger";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const FETCH_TIMEOUT = 30_000; // 30 seconds
const MAX_REDIRECTS = 5;

/**
 * Undici dispatcher that validates resolved IPs at connection time,
 * preventing TOCTOU DNS rebinding attacks.
 */
export const ssrfSafeAgent = new Agent({
	connect: {
		lookup: (hostname, options, callback) => {
			dns.lookup(hostname, options, (err, address, family) => {
				if (err) return callback(err, "", 4);
				if (typeof address === "string") {
					try {
						assertSafeIp(address, hostname);
					} catch (e) {
						return callback(e as Error, "", 4);
					}
				} else if (Array.isArray(address)) {
					for (const entry of address) {
						try {
							assertSafeIp(entry.address, hostname);
						} catch (e) {
							return callback(e as Error, "", 4);
						}
					}
				}
				return callback(null, address, family);
			});
		},
	},
});

export interface SafeFetchResult {
	text: string;
	statusCode: number;
	contentType: string;
}

export async function safeFetch(
	url: string,
	opts?: { signal?: AbortSignal; maxBytes?: number }
): Promise<SafeFetchResult> {
	if (!isValidUrl(url)) {
		throw new Error("Invalid or unsafe URL (only public HTTPS URLs are supported)");
	}

	const maxBytes = opts?.maxBytes ?? MAX_FILE_SIZE;

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

	// Chain external signal if provided
	if (opts?.signal) {
		if (opts.signal.aborted) {
			clearTimeout(timeoutId);
			controller.abort();
		} else {
			opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
		}
	}

	let currentUrl = url;
	let response: Awaited<ReturnType<typeof fetch>>;
	let redirectCount = 0;

	try {
		// eslint-disable-next-line no-constant-condition
		while (true) {
			response = await fetch(currentUrl, {
				signal: controller.signal,
				redirect: "manual",
				dispatcher: ssrfSafeAgent,
				headers: {
					"User-Agent": "HuggingChat-Attachment-Fetcher/1.0",
				},
			});

			if (response.status >= 300 && response.status < 400) {
				redirectCount++;
				if (redirectCount > MAX_REDIRECTS) {
					throw new Error("Too many redirects");
				}

				const location = response.headers.get("location");
				if (!location) {
					throw new Error("Redirect without Location header");
				}

				const redirectUrl = new URL(location, currentUrl).toString();

				if (!isValidUrl(redirectUrl)) {
					logger.warn({ redirectUrl, originalUrl: url }, "Redirect to unsafe URL blocked (SSRF)");
					throw new Error("Redirect target is not allowed");
				}

				currentUrl = redirectUrl;
				continue;
			}

			break;
		}
	} catch (err) {
		clearTimeout(timeoutId);
		throw err;
	}

	const contentType = response.headers.get("content-type") ?? "application/octet-stream";

	if (!response.ok) {
		clearTimeout(timeoutId);
		return {
			text: `HTTP error: ${response.status} ${response.statusText}`,
			statusCode: response.status,
			contentType,
		};
	}

	const contentLength = response.headers.get("content-length");
	if (contentLength && parseInt(contentLength) > maxBytes) {
		clearTimeout(timeoutId);
		throw new Error(`Response too large (max ${Math.round(maxBytes / 1024 / 1024)}MB)`);
	}

	try {
		const arrayBuffer = await response.arrayBuffer();

		if (arrayBuffer.byteLength > maxBytes) {
			throw new Error(`Response too large (max ${Math.round(maxBytes / 1024 / 1024)}MB)`);
		}

		return {
			text: new TextDecoder().decode(arrayBuffer),
			statusCode: response.status,
			contentType,
		};
	} finally {
		clearTimeout(timeoutId);
	}
}
