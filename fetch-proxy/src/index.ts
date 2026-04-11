/**
 * Sandboxed URL fetch proxy for chat-ui.
 *
 * Deployed as a Cloudflare Worker so the actual outbound fetch runs in a V8
 * isolate on Cloudflare's edge — it has no access to the main app's secrets,
 * database, or internal network. Even if SSRF protections here are bypassed,
 * the blast radius is limited to what the Worker itself can reach (the public
 * internet via Cloudflare's network).
 *
 * The main chat-ui server delegates to this Worker when FETCH_PROXY_URL is
 * configured; otherwise it falls back to an in-process fetch.
 */

export interface Env {
	/** Shared secret validated against the X-Proxy-Secret header. Set via `wrangler secret put`. */
	FETCH_PROXY_SECRET: string;
	/** Maximum bytes allowed in a response body. Configured in wrangler.toml. */
	MAX_RESPONSE_BYTES?: string;
	/** Fetch timeout in milliseconds. Configured in wrangler.toml. */
	FETCH_TIMEOUT_MS?: string;
	/** Maximum redirect hops to follow. Configured in wrangler.toml. */
	MAX_REDIRECTS?: string;
}

const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MB
const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_REDIRECTS = 5;
const USER_AGENT = "HuggingChat-Attachment-Fetcher/1.0";

const SECURITY_HEADERS: Record<string, string> = {
	"Content-Security-Policy":
		"default-src 'none'; frame-ancestors 'none'; sandbox; script-src 'none'; img-src 'none'; style-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
	"X-Content-Type-Options": "nosniff",
	"X-Frame-Options": "DENY",
	"Referrer-Policy": "no-referrer",
};

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		if (request.method === "GET" && url.pathname === "/health") {
			return new Response("ok", { status: 200 });
		}

		if (request.method !== "GET" || url.pathname !== "/fetch") {
			return errorResponse(404, "Not found");
		}

		// Auth: reject requests without a matching secret. Use a constant-time
		// comparison to avoid leaking secret length/prefix via timing.
		const providedSecret = request.headers.get("x-proxy-secret") ?? "";
		if (!env.FETCH_PROXY_SECRET || !timingSafeEqual(providedSecret, env.FETCH_PROXY_SECRET)) {
			return errorResponse(401, "Unauthorized");
		}

		const target = url.searchParams.get("url");
		if (!target) {
			return errorResponse(400, "Missing 'url' parameter");
		}

		if (!isSafeTargetUrl(target)) {
			return errorResponse(400, "Invalid or unsafe URL (only public HTTPS allowed)");
		}

		const maxBytes = parsePositiveInt(env.MAX_RESPONSE_BYTES) ?? DEFAULT_MAX_RESPONSE_BYTES;
		const timeoutMs = parsePositiveInt(env.FETCH_TIMEOUT_MS) ?? DEFAULT_FETCH_TIMEOUT_MS;
		const maxRedirects = parsePositiveInt(env.MAX_REDIRECTS) ?? DEFAULT_MAX_REDIRECTS;

		return performProxiedFetch(target, { maxBytes, timeoutMs, maxRedirects });
	},
};

async function performProxiedFetch(
	initialUrl: string,
	opts: { maxBytes: number; timeoutMs: number; maxRedirects: number }
): Promise<Response> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs);

	let currentUrl = initialUrl;
	let redirectCount = 0;
	let upstream: Response;

	try {
		// Manual redirect handling so we re-validate every hop.
		// eslint-disable-next-line no-constant-condition
		while (true) {
			upstream = await fetch(currentUrl, {
				method: "GET",
				redirect: "manual",
				signal: controller.signal,
				headers: {
					"User-Agent": USER_AGENT,
					Accept: "*/*",
				},
			});

			if (upstream.status >= 300 && upstream.status < 400) {
				redirectCount++;
				if (redirectCount > opts.maxRedirects) {
					return errorResponse(502, "Too many redirects");
				}
				const location = upstream.headers.get("location");
				if (!location) {
					return errorResponse(502, "Redirect without Location header");
				}
				const next = new URL(location, currentUrl).toString();
				if (!isSafeTargetUrl(next)) {
					return errorResponse(403, "Redirect target is not allowed");
				}
				// Drain the redirect response body so the connection can be reused.
				await upstream.body?.cancel();
				currentUrl = next;
				continue;
			}

			break;
		}
	} catch (err) {
		clearTimeout(timeoutId);
		if (err instanceof Error && err.name === "AbortError") {
			return errorResponse(504, "Upstream fetch timed out");
		}
		return errorResponse(502, "Upstream fetch failed");
	}

	if (!upstream.ok) {
		clearTimeout(timeoutId);
		return errorResponse(
			upstream.status,
			`Upstream returned ${upstream.status} ${upstream.statusText}`
		);
	}

	// Content-Length early rejection
	const contentLength = upstream.headers.get("content-length");
	if (contentLength) {
		const parsed = Number.parseInt(contentLength, 10);
		if (Number.isFinite(parsed) && parsed > opts.maxBytes) {
			clearTimeout(timeoutId);
			await upstream.body?.cancel();
			return errorResponse(413, "Upstream response exceeds max size");
		}
	}

	// Read the body with a hard byte cap, aborting the stream if it exceeds maxBytes.
	const body = upstream.body;
	if (!body) {
		clearTimeout(timeoutId);
		return buildSuccessResponse(new Uint8Array(0), upstream, currentUrl);
	}

	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		// eslint-disable-next-line no-constant-condition
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			total += value.byteLength;
			if (total > opts.maxBytes) {
				await reader.cancel();
				return errorResponse(413, "Upstream response exceeds max size");
			}
			chunks.push(value);
		}
	} catch (_err) {
		return errorResponse(502, "Failed reading upstream body");
	} finally {
		clearTimeout(timeoutId);
	}

	const merged = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.byteLength;
	}

	return buildSuccessResponse(merged, upstream, currentUrl);
}

function buildSuccessResponse(body: Uint8Array, upstream: Response, finalUrl: string): Response {
	const originalContentType = upstream.headers.get("content-type") ?? "application/octet-stream";
	const contentDisposition = upstream.headers.get("content-disposition");

	const headers: Record<string, string> = {
		"Content-Type": "application/octet-stream",
		"X-Original-Content-Type": originalContentType,
		"X-Original-Status": String(upstream.status),
		"X-Final-Url": finalUrl,
		...SECURITY_HEADERS,
	};
	if (contentDisposition) {
		headers["Content-Disposition"] = contentDisposition;
	}

	return new Response(body, { status: 200, headers });
}

function errorResponse(status: number, message: string): Response {
	return new Response(message, {
		status,
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
			...SECURITY_HEADERS,
		},
	});
}

/**
 * Hostname-level validation. Cloudflare Workers can't route to RFC1918 addresses
 * from the edge network, so string-level checks are defence-in-depth on top of
 * the network-level isolation.
 */
export function isSafeTargetUrl(raw: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(raw.trim());
	} catch {
		return false;
	}

	if (parsed.protocol !== "https:") return false;

	const hostname = parsed.hostname.toLowerCase();

	if (!hostname) return false;
	if (hostname === "localhost") return false;
	if (hostname.endsWith(".localhost")) return false;
	if (hostname.endsWith(".local")) return false;
	if (hostname.endsWith(".internal")) return false;

	// Reject bracketed IPv6 literals and raw IP literals — we require a hostname.
	if (hostname.startsWith("[") || hostname.endsWith("]")) return false;
	if (isIpLiteral(hostname)) return false;

	return true;
}

function isIpLiteral(hostname: string): boolean {
	// IPv4 dotted quad
	if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
		return hostname.split(".").every((octet) => {
			const n = Number.parseInt(octet, 10);
			return Number.isFinite(n) && n >= 0 && n <= 255;
		});
	}
	// IPv6 (contains colon; URL parsing strips brackets from hostname)
	if (hostname.includes(":")) return true;
	return false;
}

function parsePositiveInt(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const n = Number.parseInt(value, 10);
	if (!Number.isFinite(n) || n <= 0) return undefined;
	return n;
}

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let mismatch = 0;
	for (let i = 0; i < a.length; i++) {
		mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return mismatch === 0;
}
