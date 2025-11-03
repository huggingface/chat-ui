import { error } from "@sveltejs/kit";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const FETCH_TIMEOUT = 30000; // 30 seconds

// Validate URL safety - HTTPS only
function isValidUrl(urlString: string): boolean {
	try {
		const url = new URL(urlString);
		// Only allow HTTPS protocol
		if (url.protocol !== "https:") {
			return false;
		}
		// Prevent localhost/private IPs (basic check)
		const hostname = url.hostname.toLowerCase();
		if (
			hostname === "localhost" ||
			hostname.startsWith("127.") ||
			hostname.startsWith("192.168.") ||
			hostname.startsWith("10.") ||
			hostname.startsWith("172.16.") ||
			hostname === "[::1]" ||
			hostname === "0.0.0.0"
		) {
			return false;
		}
		return true;
	} catch {
		return false;
	}
}

export async function GET({ url, fetch }) {
	const targetUrl = url.searchParams.get("url");

	if (!targetUrl) {
		throw error(400, "Missing 'url' parameter");
	}

	if (!isValidUrl(targetUrl)) {
		throw error(400, "Invalid or unsafe URL (only HTTPS is supported)");
	}

	try {
		// Fetch with timeout
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

		const response = await fetch(targetUrl, {
			signal: controller.signal,
			redirect: "error", // Block all redirects
			headers: {
				"User-Agent": "HuggingChat-Attachment-Fetcher/1.0",
			},
		}).finally(() => clearTimeout(timeoutId));

		if (!response.ok) {
			throw error(response.status, `Failed to fetch: ${response.statusText}`);
		}

		// Check content length if available
		const contentLength = response.headers.get("content-length");
		if (contentLength && parseInt(contentLength) > MAX_FILE_SIZE) {
			throw error(413, "File too large (max 10MB)");
		}

		// Stream the response back
		const contentType = response.headers.get("content-type") || "application/octet-stream";
		const contentDisposition = response.headers.get("content-disposition");

		const headers: HeadersInit = {
			"Content-Type": contentType,
			"Cache-Control": "public, max-age=3600",
		};

		if (contentDisposition) {
			headers["Content-Disposition"] = contentDisposition;
		}

		// Get the body as array buffer to check size
		const arrayBuffer = await response.arrayBuffer();

		if (arrayBuffer.byteLength > MAX_FILE_SIZE) {
			throw error(413, "File too large (max 10MB)");
		}

		return new Response(arrayBuffer, { headers });
	} catch (err) {
		if (err instanceof Error) {
			if (err.name === "AbortError") {
				throw error(504, "Request timeout");
			}
			console.error("Error fetching URL:", err);
			throw error(500, `Failed to fetch URL: ${err.message}`);
		}
		throw error(500, "Failed to fetch URL");
	}
}
