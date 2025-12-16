import { error } from "@sveltejs/kit";
import { logger } from "$lib/server/logger.js";
import { fetch } from "undici";
import { isValidUrl } from "$lib/server/urlSafety";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const FETCH_TIMEOUT = 30000; // 30 seconds
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

	try {
		// Fetch with timeout
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

		const response = await fetch(targetUrl, {
			signal: controller.signal,
			headers: {
				"User-Agent": "HuggingChat-Attachment-Fetcher/1.0",
			},
		}).finally(() => clearTimeout(timeoutId));

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
	} catch (err) {
		if (err instanceof Error) {
			if (err.name === "AbortError") {
				logger.error(err, "Request timeout");
				throw error(504, "Request timeout");
			}

			logger.error(err, "Error fetching URL");
			throw error(500, `Failed to fetch URL: ${err.message}`);
		}
		logger.error(err, "Error fetching URL");
		throw error(500, "Failed to fetch URL.");
	}
}
