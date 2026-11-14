import { ssrfSafeFetch } from "$lib/server/urlSafety";

export const MAX_PDF_BYTES = 40 * 1024 * 1024;
const TIMEOUT_MS = 60_000;

/**
 * Fetch a PDF through the SSRF-guarded fetch (every redirect hop is checked),
 * capped in size and checked to really be a PDF — arXiv answers a paper whose
 * PDF is still being generated with an HTML page.
 */
export async function downloadPdf(
	url: string,
	signal?: AbortSignal
): Promise<{ data: Uint8Array } | { error: string }> {
	const timeout = AbortSignal.timeout(TIMEOUT_MS);
	const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
	let response: Response;
	try {
		response = await ssrfSafeFetch(url, {
			signal: combined,
			headers: { "User-Agent": "HuggingChat-PaperReader/1.0", Accept: "application/pdf" },
		});
	} catch (err) {
		if (timeout.aborted) return { error: `Timed out fetching ${url}.` };
		return { error: `Could not fetch ${url}: ${err instanceof Error ? err.message : String(err)}` };
	}
	if (!response.ok) {
		return { error: `Fetching ${url} failed with HTTP ${response.status}.` };
	}
	const length = Number(response.headers.get("content-length") ?? 0);
	if (length > MAX_PDF_BYTES) {
		return { error: `The PDF is ${Math.round(length / 1e6)} MB; the reader takes up to 40 MB.` };
	}

	const reader = response.body?.getReader();
	if (!reader) return { error: `Empty response from ${url}.` };
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > MAX_PDF_BYTES) {
			await reader.cancel();
			return { error: "The PDF is larger than 40 MB, which is the reader's limit." };
		}
		chunks.push(value);
	}
	const data = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		data.set(chunk, offset);
		offset += chunk.byteLength;
	}
	// "%PDF-" somewhere in the first KiB, as readers accept
	const head = Buffer.from(data.subarray(0, 1024)).toString("latin1");
	if (!head.includes("%PDF-")) {
		const type = response.headers.get("content-type") ?? "unknown type";
		return { error: `${url} did not return a PDF (got ${type}).` };
	}
	return { data };
}
