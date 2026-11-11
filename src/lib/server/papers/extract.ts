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
	title?: string;
	outline: PdfOutlineEntry[];
}

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjs: Promise<PdfJs> | undefined;

/** Loaded on first use: it is a large module that most requests never need. */
function loadPdfJs(): Promise<PdfJs> {
	pdfjs ??= import("pdfjs-dist/legacy/build/pdf.mjs");
	return pdfjs;
}

const MAX_OUTLINE = 80;

export async function extractPdf(data: Uint8Array): Promise<ExtractedPdf> {
	const { getDocument, VerbosityLevel } = await loadPdfJs();
	// pdf.js takes ownership of the buffer it is given; hand it a copy so the
	// caller can still store the original bytes.
	const task = getDocument({
		data: data.slice(),
		disableFontFace: true,
		useSystemFonts: false,
		verbosity: VerbosityLevel.ERRORS,
	});
	const doc = await task.promise;
	try {
		const pages: string[] = [];
		for (let n = 1; n <= doc.numPages; n++) {
			const page = await doc.getPage(n);
			const content = await page.getTextContent();
			let text = "";
			for (const item of content.items) {
				if (!("str" in item)) continue;
				text += item.str;
				text += item.hasEOL ? "\n" : "";
			}
			pages.push(text.replace(/[ \t]+\n/g, "\n").trim());
			page.cleanup();
		}

		const meta = await doc.getMetadata().catch(() => null);
		const info = meta?.info as { Title?: unknown } | undefined;
		const title = typeof info?.Title === "string" ? info.Title.trim() : undefined;

		const outline: PdfOutlineEntry[] = [];
		const items = await doc.getOutline().catch(() => null);
		const walk = async (
			nodes: Awaited<ReturnType<typeof doc.getOutline>> | null,
			depth: number
		): Promise<void> => {
			for (const node of nodes ?? []) {
				if (outline.length >= MAX_OUTLINE) return;
				const page = await destinationPage(doc, node.dest).catch(() => null);
				if (page) outline.push({ title: node.title.trim(), page, depth });
				if (depth < 1) await walk(node.items, depth + 1);
			}
		};
		await walk(items, 0);

		return { pages, ...(title ? { title } : {}), outline };
	} finally {
		await task.destroy();
	}
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
