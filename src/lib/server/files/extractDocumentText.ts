import { DOCUMENT_MIME_ALLOWLIST } from "$lib/constants/mime";
import { mimeMatchesAllowlist } from "$lib/utils/mime";
import { logger } from "$lib/server/logger";

// Per-file cap on extracted characters injected into the prompt.
export const DOCUMENT_TEXT_CHAR_BUDGET = 100_000;

export type DocumentExtractionResult =
	| { kind: "text"; text: string; truncated: boolean; totalChars: number }
	| { kind: "empty" }
	| { kind: "error"; reason: string };

export function isDocumentMime(mime: string): boolean {
	return mimeMatchesAllowlist(mime, DOCUMENT_MIME_ALLOWLIST);
}

// Bounds applied while parsing, not after: a <=10MB PDF can still be a
// decompression/object bomb, and unpdf runs pdf.js in-process on the event loop.
const MAX_PDF_PAGES = 500;
const EXTRACTION_TIMEOUT_MS = 20_000;

type DocumentExtractor = (
	data: Uint8Array,
	charBudget: number
) => Promise<{ text: string; pagesTruncated: boolean }>;

const EXTRACTORS: Record<string, DocumentExtractor> = {
	"application/pdf": async (data, charBudget) => {
		// Dynamic import keeps pdf.js out of the cold-start path.
		const { getDocumentProxy } = await import("unpdf");
		const pdf = await getDocumentProxy(data);
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const timeout = new Promise<never>((_, reject) => {
				timer = setTimeout(() => {
					const err = new Error("document extraction timed out");
					err.name = "ExtractionTimeout";
					reject(err);
				}, EXTRACTION_TIMEOUT_MS);
			});
			const extractPages = async () => {
				const pageCount = Math.min(pdf.numPages, MAX_PDF_PAGES);
				const pageTexts: string[] = [];
				let length = 0;
				// Stop as soon as the budget is met so huge documents are never fully parsed.
				for (let i = 1; i <= pageCount && length <= charBudget; i++) {
					const page = await pdf.getPage(i);
					const content = await page.getTextContent();
					const pageText = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
					pageTexts.push(pageText);
					length += pageText.length;
				}
				return {
					text: pageTexts.join("\n\n"),
					pagesTruncated: pdf.numPages > pageTexts.length,
				};
			};
			return await Promise.race([extractPages(), timeout]);
		} finally {
			clearTimeout(timer);
			await pdf.destroy();
		}
	},
};

export async function extractDocumentText(
	data: Uint8Array,
	mime: string,
	options?: { charBudget?: number }
): Promise<DocumentExtractionResult> {
	const normalizedMime = (mime || "").toLowerCase().split(";")[0].trim();
	const extractor = EXTRACTORS[normalizedMime];
	if (!extractor) {
		return { kind: "error", reason: "unsupported document type" };
	}

	try {
		// Copy the input: pdf.js may transfer/detach the underlying ArrayBuffer, and the
		// caller's view can be a slice of Node's shared Buffer pool.
		const copy = new Uint8Array(data);
		const budget = options?.charBudget ?? DOCUMENT_TEXT_CHAR_BUDGET;
		const { text, pagesTruncated } = await extractor(copy, budget);

		if (text.trim().length === 0) {
			return { kind: "empty" };
		}

		const totalChars = text.length;
		if (totalChars > budget || pagesTruncated) {
			return { kind: "text", text: text.slice(0, budget), truncated: true, totalChars };
		}
		return { kind: "text", text, truncated: false, totalChars };
	} catch (err) {
		if (err instanceof Error && err.name === "PasswordException") {
			return { kind: "error", reason: "password-protected" };
		}
		if (err instanceof Error && err.name === "ExtractionTimeout") {
			logger.warn({ mime: normalizedMime }, "[files] document text extraction timed out");
			return { kind: "error", reason: "extraction timed out" };
		}
		logger.warn({ err }, "[files] document text extraction failed");
		return { kind: "error", reason: "unreadable or corrupted" };
	}
}
