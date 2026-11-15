/**
 * Page text and outline from a PDF, with the same pdf.js the reader renders
 * with. Using one engine on both sides matters: the server checks quotes and
 * the model cites passages against this text, and the reader then finds those
 * passages in its own text layer, which pdf.js builds from the same items.
 */

export interface PdfOutlineEntry {
	title: string;
	page: number;
	depth: number;
}

export interface ExtractedPdf {
	pages: string[];
	/** the document's metadata title */
	title?: string;
	/** the largest type on page 1, which on a paper is its title */
	displayTitle?: string;
	outline: PdfOutlineEntry[];
}

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjs: Promise<PdfJs> | undefined;

/** Loaded on first use: it is a large module that most requests never need. */
function loadPdfJs(): Promise<PdfJs> {
	pdfjs ??= import("pdfjs-dist/legacy/build/pdf.mjs");
	return pdfjs;
}

import { MAX_PAPER_PAGES } from "$lib/utils/paper";

const MAX_OUTLINE = 80;
/** A page of a real paper is a few thousand characters; past this it is not prose. */
export const MAX_PAGE_CHARS = 60_000;
/** Text kept for the whole document, which is what read_paper and quote checks load. */
export const MAX_TOTAL_CHARS = 2_000_000;
/** Wall-clock budget for parsing, after the download's own timeout. */
const EXTRACT_TIMEOUT_MS = 45_000;

export class PdfLimitError extends Error {}

/** One line, no control characters: outline titles and metadata come from the document. */
export function cleanDocumentText(value: string, max = 200): string {
	return (
		value
			// control characters are what this strips
			// eslint-disable-next-line no-control-regex
			.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, max)
	);
}

/**
 * Bounded before it does the work: the page count is checked before any page
 * is read, each page's text and the document's total are capped, and the whole
 * parse races a deadline and the caller's abort signal (the task is destroyed
 * when either wins). A 40 MB download cap alone bounds none of these — a few KB
 * of PDF can declare thousands of pages.
 */
export async function extractPdf(
	data: Uint8Array,
	{ signal, timeoutMs = EXTRACT_TIMEOUT_MS }: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<ExtractedPdf> {
	const { getDocument, VerbosityLevel } = await loadPdfJs();
	const deadline = AbortSignal.timeout(timeoutMs);
	const deadlineAt = Date.now() + timeoutMs;
	// In Node pdf.js parses on this thread, in microtasks that never let a timer
	// fire, so the clock is also checked per page, and each page yields to the
	// event loop so one large PDF cannot starve every other request.
	const checkpoint = async () => {
		await new Promise((resolve) => setImmediate(resolve));
		if (signal?.aborted) throw new Error("Cancelled.");
		if (Date.now() >= deadlineAt) throw new PdfLimitError("Reading the PDF took too long.");
	};
	const stop = signal ? AbortSignal.any([signal, deadline]) : deadline;
	const bounded = <T>(work: Promise<T>): Promise<T> =>
		new Promise<T>((resolve, reject) => {
			const onStop = () =>
				reject(
					deadline.aborted
						? new PdfLimitError("Reading the PDF took too long.")
						: new Error("Cancelled.")
				);
			if (stop.aborted) return onStop();
			stop.addEventListener("abort", onStop, { once: true });
			work.then(resolve, reject).finally(() => stop.removeEventListener("abort", onStop));
		});

	// pdf.js takes ownership of the buffer it is given; hand it a copy so the
	// caller can still store the original bytes.
	const task = getDocument({
		data: data.slice(),
		disableFontFace: true,
		useSystemFonts: false,
		verbosity: VerbosityLevel.ERRORS,
	});
	try {
		const doc = await bounded(task.promise);
		if (doc.numPages > MAX_PAPER_PAGES) {
			throw new PdfLimitError(
				`The PDF has ${doc.numPages} pages; the reader takes up to ${MAX_PAPER_PAGES}.`
			);
		}
		const pages: string[] = [];
		let displayTitle: string | undefined;
		let total = 0;
		for (let n = 1; n <= doc.numPages; n++) {
			await checkpoint();
			const page = await bounded(doc.getPage(n));
			const content = await bounded(page.getTextContent());
			let text = "";
			for (const item of content.items) {
				if (!("str" in item)) continue;
				text += item.str;
				text += item.hasEOL ? "\n" : "";
				if (text.length >= MAX_PAGE_CHARS) break;
			}
			if (n === 1) displayTitle = largestLine(content.items);
			text = text
				.slice(0, MAX_PAGE_CHARS)
				.replace(/[ \t]+\n/g, "\n")
				.trim();
			total += text.length;
			if (total > MAX_TOTAL_CHARS) {
				throw new PdfLimitError("The PDF has more text than the reader takes.");
			}
			pages.push(text);
			page.cleanup();
		}

		const meta = await bounded(doc.getMetadata()).catch(() => null);
		const info = meta?.info as { Title?: unknown } | undefined;
		const title = typeof info?.Title === "string" ? cleanDocumentText(info.Title, 300) : undefined;

		const outline: PdfOutlineEntry[] = [];
		const items = await bounded(doc.getOutline()).catch(() => null);
		const walk = async (
			nodes: Awaited<ReturnType<typeof doc.getOutline>> | null,
			depth: number
		): Promise<void> => {
			for (const node of nodes ?? []) {
				if (outline.length >= MAX_OUTLINE) return;
				const page = await bounded(destinationPage(doc, node.dest)).catch(() => null);
				const label = cleanDocumentText(node.title ?? "");
				if (page && label) outline.push({ title: label, page, depth });
				if (depth < 1) await walk(node.items, depth + 1);
			}
		};
		await walk(items, 0);

		return {
			pages,
			...(title ? { title } : {}),
			...(displayTitle ? { displayTitle } : {}),
			outline,
		};
	} finally {
		await task.destroy();
	}
}

interface LaidOutText {
	str: string;
	hasEOL: boolean;
	height: number;
	transform: number[];
}

/**
 * The line set in the largest type on a page, joined with the lines after it
 * in the same size (a title often wraps). Running headers ("Journal of …,
 * Submitted 11/13") sit above the title in smaller type, which is why the
 * first line is a poor name. Rotated text is skipped: arXiv stamps its id up
 * the margin in larger type than most titles. Undefined when nothing stands
 * out from the body text.
 */
export function largestLine(items: ReadonlyArray<object>): string | undefined {
	const lines: Array<{ text: string; size: number }> = [];
	let current = { text: "", size: 0 };
	for (const raw of items) {
		if (!("str" in raw)) continue;
		const item = raw as LaidOutText;
		const [, b, c] = item.transform;
		if (b === 0 && c === 0 && item.str.trim()) {
			current.text += item.str;
			current.size = Math.max(current.size, item.height);
		} else if (item.str === " " || item.str === "") {
			current.text += item.str;
		}
		if (item.hasEOL) {
			lines.push(current);
			current = { text: "", size: 0 };
		}
	}
	lines.push(current);
	const real = lines.filter((l) => l.size > 0 && /\p{L}{2}/u.test(l.text));
	if (real.length < 2) return undefined;
	const sizes = real.map((l) => l.size).sort((x, y) => x - y);
	const median = sizes[Math.floor(sizes.length / 2)];
	const largest = sizes[sizes.length - 1];
	if (largest < median * 1.15) return undefined;
	const first = real.findIndex((l) => l.size >= largest * 0.97);
	const parts: string[] = [];
	for (const line of real.slice(first, first + 3)) {
		if (line.size < largest * 0.97) break;
		parts.push(line.text);
	}
	const title = cleanDocumentText(parts.join(" "), 300);
	return title.length >= 8 ? title : undefined;
}

type Doc = Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>;

async function destinationPage(doc: Doc, dest: unknown): Promise<number | null> {
	const explicit = typeof dest === "string" ? await doc.getDestination(dest) : dest;
	if (!Array.isArray(explicit) || explicit.length === 0) return null;
	const ref = explicit[0];
	if (typeof ref === "number") return ref + 1;
	if (ref && typeof ref === "object") {
		const index = await doc.getPageIndex(ref as Parameters<Doc["getPageIndex"]>[0]);
		return index + 1;
	}
	return null;
}
