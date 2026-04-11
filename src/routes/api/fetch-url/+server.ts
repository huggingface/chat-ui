import { error } from "@sveltejs/kit";
import { logger } from "$lib/server/logger.js";
import { isValidUrl, ssrfSafeFetch } from "$lib/server/urlSafety";
import { config } from "$lib/server/config";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const FETCH_TIMEOUT = 30000; // 30 seconds
const MAX_REDIRECTS = 5;
const SECURITY_HEADERS: HeadersInit = {
	// Prevent any active content from executing if someone navigates directly to this endpoint.
	"Content-Security-Policy":
		"default-src 'none'; frame-ancestors 'none'; sandbox; script-src 'none'; img-src 'none'; style-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
	"X-Content-Type-Options": "nosniff",
	"X-Frame-Options": "DENY",
	"Referrer-Policy": "no-referrer",
};

export async function GET({ url }) {
	const targetUrl = url.searchParams.get("url");

	if (!targetUrl) {
		logger.warn("Missing 'url' parameter");
		throw error(400, "Missing 'url' parameter");
	}

	if (!isValidUrl(targetUrl)) {
		logger.warn({ targetUrl }, "Invalid or unsafe URL (only HTTPS is supported)");
		throw error(400, "Invalid or unsafe URL (only HTTPS is supported)");
	}

	// If an external sandbox proxy is configured, delegate the actual fetch to
	// it (e.g. a Cloudflare Worker in `fetch-proxy/`) so the outbound request
	// never touches this process's network or env. Self-hosted deployments that
	// don't set FETCH_PROXY_URL continue to use the in-process fetch path below.
	const proxyUrl = config.FETCH_PROXY_URL;
	const proxySecret = config.FETCH_PROXY_SECRET;
	if (proxyUrl) {
		return delegateToProxy(targetUrl, proxyUrl, proxySecret);
	}

	// Fetch with timeout, following redirects manually to validate each hop
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

	let currentUrl = targetUrl;
	let response: Response;
	let redirectCount = 0;

	try {
		// eslint-disable-next-line no-constant-condition
		while (true) {
			response = await ssrfSafeFetch(currentUrl, {
				signal: controller.signal,
				redirect: "manual",
				headers: {
					"User-Agent": "HuggingChat-Attachment-Fetcher/1.0",
				},
			});

			if (response.status >= 300 && response.status < 400) {
				redirectCount++;
				if (redirectCount > MAX_REDIRECTS) {
					throw error(502, "Too many redirects");
				}

				const location = response.headers.get("location");
				if (!location) {
					throw error(502, "Redirect without Location header");
				}

				// Resolve relative redirects against the current URL
				const redirectUrl = new URL(location, currentUrl).toString();

				if (!isValidUrl(redirectUrl)) {
					logger.warn(
						{ redirectUrl, originalUrl: targetUrl },
						"Redirect to unsafe URL blocked (SSRF)"
					);
					throw error(403, "Redirect target is not allowed");
				}

				currentUrl = redirectUrl;
				continue;
			}

			break;
		}
	} finally {
		clearTimeout(timeoutId);
	}

	if (!response.ok) {
		logger.error({ targetUrl, response }, "Error fetching URL. Response not ok.");
		throw error(response.status, `Failed to fetch: ${response.statusText}`);
	}

	// Check content length if available
	const contentLength = response.headers.get("content-length");
	if (contentLength && parseInt(contentLength) > MAX_FILE_SIZE) {
		throw error(413, "File too large (max 10MB)");
	}

	// Stream the response back
	const originalContentType = response.headers.get("content-type") || "application/octet-stream";
	// Send as text/plain for safety; expose the original type via secondary header
	const safeContentType = "text/plain; charset=utf-8";
	const contentDisposition = response.headers.get("content-disposition");

	const headers: HeadersInit = {
		"Content-Type": safeContentType,
		"X-Forwarded-Content-Type": originalContentType,
		"Cache-Control": "public, max-age=3600",
		...(contentDisposition ? { "Content-Disposition": contentDisposition } : {}),
		...SECURITY_HEADERS,
	};

	// Get the body as array buffer to check size
	const arrayBuffer = await response.arrayBuffer();

	if (arrayBuffer.byteLength > MAX_FILE_SIZE) {
		throw error(413, "File too large (max 10MB)");
	}

	return new Response(arrayBuffer, { headers });
}

/**
 * Delegate the fetch to an external sandbox proxy (Cloudflare Worker) so the
 * actual outbound request runs in an isolated V8 environment with no access
 * to this app's env vars, database, or internal network.
 *
 * The Worker contract (see `fetch-proxy/src/index.ts`):
 *   GET {proxyUrl}/fetch?url=<encoded>    headers: X-Proxy-Secret
 *   -> 200 application/octet-stream with X-Original-Content-Type,
 *      X-Original-Status, X-Final-Url, Content-Disposition (if present)
 *   -> 4xx / 5xx text/plain on error (including proxy-side SSRF rejections)
 */
async function delegateToProxy(
	targetUrl: string,
	proxyUrl: string,
	proxySecret: string
): Promise<Response> {
	if (!proxySecret) {
		logger.error("FETCH_PROXY_URL is set but FETCH_PROXY_SECRET is empty");
		throw error(500, "Fetch proxy misconfigured");
	}

	const proxyEndpoint = new URL("/fetch", proxyUrl);
	proxyEndpoint.searchParams.set("url", targetUrl);

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

	let proxyResponse: Response;
	try {
		proxyResponse = await fetch(proxyEndpoint, {
			method: "GET",
			signal: controller.signal,
			headers: {
				"X-Proxy-Secret": proxySecret,
				"User-Agent": "HuggingChat-Attachment-Fetcher/1.0",
			},
		});
	} catch (err) {
		clearTimeout(timeoutId);
		const message =
			err instanceof Error && err.name === "AbortError"
				? "Fetch proxy timed out"
				: "Fetch proxy unreachable";
		logger.error({ targetUrl, err }, message);
		throw error(502, message);
	} finally {
		clearTimeout(timeoutId);
	}

	if (!proxyResponse.ok) {
		const body = await safeReadText(proxyResponse);
		logger.warn(
			{ targetUrl, proxyStatus: proxyResponse.status, body },
			"Fetch proxy returned error"
		);
		// Bubble up the proxy's status code so the client sees the same semantics
		// (e.g. 400 for bad URL, 413 for too large, 403 for blocked redirect).
		throw error(proxyResponse.status, body || `Fetch proxy failed: ${proxyResponse.statusText}`);
	}

	const arrayBuffer = await proxyResponse.arrayBuffer();
	if (arrayBuffer.byteLength > MAX_FILE_SIZE) {
		// Defensive: the Worker also enforces this limit, but double-check here.
		throw error(413, "File too large (max 10MB)");
	}

	const originalContentType =
		proxyResponse.headers.get("x-original-content-type") || "application/octet-stream";
	const contentDisposition = proxyResponse.headers.get("content-disposition");

	const headers: HeadersInit = {
		"Content-Type": "text/plain; charset=utf-8",
		"X-Forwarded-Content-Type": originalContentType,
		"Cache-Control": "public, max-age=3600",
		...(contentDisposition ? { "Content-Disposition": contentDisposition } : {}),
		...SECURITY_HEADERS,
	};

	return new Response(arrayBuffer, { headers });
}

async function safeReadText(response: Response): Promise<string> {
	try {
		return (await response.text()).slice(0, 512);
	} catch {
		return "";
	}
}
