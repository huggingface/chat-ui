import { base } from "$app/paths";
import { pickSafeMime } from "$lib/utils/mime";

export interface AttachmentLoadResult {
	files: File[];
	errors: string[];
}

/**
 * Extract filename from URL or Content-Disposition header
 */
function extractFilename(url: string, contentDisposition?: string | null): string {
	// Try to get filename from Content-Disposition header
	if (contentDisposition) {
		const filenameStar = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
		if (filenameStar) {
			const cleaned = filenameStar.trim().replace(/['"]/g, "");
			try {
				return decodeURIComponent(cleaned);
			} catch {
				return cleaned;
			}
		}

		const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
		if (match && match[1]) return match[1].replace(/['"]/g, "");
	}

	// Fallback: extract from URL
	try {
		const urlObj = new URL(url);
		const pathname = urlObj.pathname;
		const segments = pathname.split("/");
		const lastSegment = segments[segments.length - 1];

		if (lastSegment && lastSegment.length > 0) {
			return decodeURIComponent(lastSegment);
		}
	} catch {
		// Invalid URL, fall through to default
	}

	return "attachment";
}

/**
 * Load files from remote URLs via the server-side proxy. The caller decides
 * which URLs to load and when — see `readLinkPromptRequest` for how they are
 * parsed off a deep link, and the routes for the confirmation that precedes
 * this for untrusted sources.
 */
export async function loadAttachmentsFromUrls(urls: string[]): Promise<AttachmentLoadResult> {
	if (urls.length === 0) {
		return { files: [], errors: [] };
	}

	const files: File[] = [];
	const errors: string[] = [];

	await Promise.all(
		urls.map(async (url) => {
			try {
				// Fetch via our proxy endpoint to bypass CORS
				const proxyUrl = `${base}/api/fetch-url?${new URLSearchParams({ url })}`;
				const response = await fetch(proxyUrl);

				if (!response.ok) {
					const errorText = await response.text();
					errors.push(`Failed to fetch ${url}: ${errorText}`);
					return;
				}

				const forwardedType = response.headers.get("x-forwarded-content-type");
				const blob = await response.blob();
				const mimeType = pickSafeMime(forwardedType, blob.type, url);
				const contentDisposition = response.headers.get("content-disposition");
				const filename = extractFilename(url, contentDisposition);

				// Create File object
				const file = new File([blob], filename, {
					type: mimeType,
				});

				files.push(file);
			} catch (err) {
				const message = err instanceof Error ? err.message : "Unknown error";
				errors.push(`Failed to load ${url}: ${message}`);
				console.error(`Error loading attachment from ${url}:`, err);
			}
		})
	);

	return { files, errors };
}
