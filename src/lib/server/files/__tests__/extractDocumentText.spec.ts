import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { extractDocumentText, isDocumentMime } from "$lib/server/files/extractDocumentText";

const FIXTURE_TEXT = "Hello chat-ui PDF fixture";

async function loadFixture(name: string): Promise<Uint8Array> {
	return new Uint8Array(await readFile(new URL(`./fixtures/${name}`, import.meta.url)));
}

describe("extractDocumentText", () => {
	it("extracts text from a valid PDF", async () => {
		const data = await loadFixture("sample.pdf");
		const result = await extractDocumentText(data, "application/pdf");

		expect(result.kind).toBe("text");
		if (result.kind !== "text") throw new Error("expected text result");
		expect(result.text).toContain(FIXTURE_TEXT);
		expect(result.truncated).toBe(false);
		expect(result.totalChars).toBeGreaterThan(0);
	});

	it("returns empty for a PDF page without extractable text", async () => {
		const data = await loadFixture("empty-text.pdf");
		const result = await extractDocumentText(data, "application/pdf");

		expect(result.kind).toBe("empty");
	});

	it("returns error (and does not throw) for corrupt bytes", async () => {
		const data = await loadFixture("corrupt.pdf");
		const result = await extractDocumentText(data, "application/pdf");

		expect(result.kind).toBe("error");
	});

	it("truncates extracted text to the char budget", async () => {
		const data = await loadFixture("sample.pdf");
		const full = await extractDocumentText(data, "application/pdf");
		if (full.kind !== "text") throw new Error("expected text result");

		const result = await extractDocumentText(data, "application/pdf", { charBudget: 10 });
		expect(result.kind).toBe("text");
		if (result.kind !== "text") throw new Error("expected text result");
		expect(result.truncated).toBe(true);
		expect(result.text.length).toBe(10);
		expect(result.totalChars).toBe(full.totalChars);
	});

	it("returns error for unsupported document types", async () => {
		const result = await extractDocumentText(new Uint8Array([1, 2, 3]), "application/zip");
		expect(result.kind).toBe("error");
	});
});

describe("isDocumentMime", () => {
	it("accepts application/pdf", () => {
		expect(isDocumentMime("application/pdf")).toBe(true);
	});

	it("is case-insensitive", () => {
		expect(isDocumentMime("application/PDF")).toBe(true);
	});

	it("ignores mime parameters", () => {
		expect(isDocumentMime("application/pdf; charset=x")).toBe(true);
	});

	it("rejects non-document mimes", () => {
		expect(isDocumentMime("text/plain")).toBe(false);
	});
});
