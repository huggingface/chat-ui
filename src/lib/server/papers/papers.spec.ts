import { describe, expect, it } from "vitest";
import { resolvePaperSource } from "./source";
import { extractPdf } from "./extract";
import { parsePageSpec } from "$lib/server/textGeneration/builtinTools/paperTools";

describe("resolvePaperSource", () => {
	it.each([
		["1706.03762", "1706.03762", "https://arxiv.org/pdf/1706.03762"],
		["arXiv:1706.03762v7", "1706.03762", "https://arxiv.org/pdf/1706.03762v7"],
		["https://arxiv.org/abs/2401.12345", "2401.12345", "https://arxiv.org/pdf/2401.12345"],
		["https://arxiv.org/pdf/2401.12345v2.pdf", "2401.12345", "https://arxiv.org/pdf/2401.12345v2"],
		["https://huggingface.co/papers/2401.12345", "2401.12345", "https://arxiv.org/pdf/2401.12345"],
		["hep-th/9901001", "hep-th/9901001", "https://arxiv.org/pdf/hep-th/9901001"],
	])("reads %s as an arXiv paper", (input, id, pdfUrl) => {
		const source = resolvePaperSource(input);
		expect(source).toMatchObject({ kind: "arxiv", arxivId: id, pdfUrl });
	});

	it("takes any other https URL as a PDF", () => {
		expect(resolvePaperSource("https://example.com/paper.pdf")).toEqual({
			kind: "url",
			pdfUrl: "https://example.com/paper.pdf",
		});
	});

	it("refuses what it cannot fetch", () => {
		expect(resolvePaperSource("http://example.com/a.pdf")).toHaveProperty("error");
		expect(resolvePaperSource("attention is all you need")).toHaveProperty("error");
		expect(resolvePaperSource("https://huggingface.co/papers")).toHaveProperty("error");
	});
});

describe("parsePageSpec", () => {
	it("reads pages and ranges", () => {
		expect(parsePageSpec("3", 10)).toEqual([3]);
		expect(parsePageSpec("1, 4,7-8", 10)).toEqual([1, 4, 7, 8]);
		expect(parsePageSpec("9-20", 10)).toEqual([9, 10]);
	});

	it("explains a bad spec", () => {
		expect(parsePageSpec("11", 10)).toHaveProperty("error");
		expect(parsePageSpec("5-3", 10)).toHaveProperty("error");
		expect(parsePageSpec("intro", 10)).toHaveProperty("error");
		expect(parsePageSpec("", 10)).toHaveProperty("error");
	});
});

/** The smallest PDF with a text run: one page saying "Hello paper reader". */
function tinyPdf(text: string): Uint8Array {
	const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
		`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	];
	let pdf = "%PDF-1.4\n";
	const offsets: number[] = [];
	objects.forEach((body, i) => {
		offsets.push(pdf.length);
		pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
	});
	const xref = pdf.length;
	pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
	pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
	return new TextEncoder().encode(pdf);
}

describe("extractPdf", () => {
	it("returns one text string per page", async () => {
		const extracted = await extractPdf(tinyPdf("Hello paper reader"));
		expect(extracted.pages).toEqual(["Hello paper reader"]);
		expect(extracted.outline).toEqual([]);
	});
});
