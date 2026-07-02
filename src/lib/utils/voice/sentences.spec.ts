import { describe, expect, it } from "vitest";
import { cleanTextForSpeech, extractSpeakableChunks } from "./sentences";

describe("extractSpeakableChunks", () => {
	it("returns nothing while the first sentence is incomplete", () => {
		const { chunks, offset } = extractSpeakableChunks("The quick brown fox jumps", 0);
		expect(chunks).toEqual([]);
		expect(offset).toBe(0);
	});

	it("extracts a completed sentence and advances the offset", () => {
		const text = "The quick brown fox jumps over the lazy dog. And then";
		const { chunks, offset } = extractSpeakableChunks(text, 0);
		expect(chunks).toEqual(["The quick brown fox jumps over the lazy dog."]);
		expect(text.slice(offset).trimStart()).toBe("And then");
	});

	it("merges short sentences with the following one", () => {
		const text = "Yes. That is a much longer sentence that easily crosses the threshold. tail";
		const { chunks } = extractSpeakableChunks(text, 0);
		expect(chunks).toEqual([
			"Yes. That is a much longer sentence that easily crosses the threshold.",
		]);
	});

	it("does not split decimal numbers", () => {
		const text = "Inflation was about 3.5 percent last year, which was widely expected. next";
		const { chunks } = extractSpeakableChunks(text, 0);
		expect(chunks).toEqual([
			"Inflation was about 3.5 percent last year, which was widely expected.",
		]);
	});

	it("flushes the remaining tail when the stream ends", () => {
		const text = "First complete sentence that is long enough to emit right away. short tail";
		const first = extractSpeakableChunks(text, 0);
		const flushed = extractSpeakableChunks(text, first.offset, true);
		expect(flushed.chunks).toEqual(["short tail"]);
		expect(flushed.offset).toBe(text.length);
	});

	it("consumes incrementally as the stream grows", () => {
		const part1 = "Already spoken sentence, quite long indeed it is. New sent";
		const first = extractSpeakableChunks(part1, 0);
		expect(first.chunks).toEqual(["Already spoken sentence, quite long indeed it is."]);

		const full = part1 + "ence arriving now, also long enough to pass. ";
		const second = extractSpeakableChunks(full, first.offset);
		expect(second.chunks).toEqual(["New sentence arriving now, also long enough to pass."]);
	});

	it("cuts punctuation-less streams at a soft boundary", () => {
		const text = `${"word ".repeat(80)}`;
		const { chunks } = extractSpeakableChunks(text, 0);
		expect(chunks.length).toBeGreaterThan(0);
		expect(chunks[0].length).toBeLessThanOrEqual(280);
	});
});

describe("cleanTextForSpeech", () => {
	it("strips markdown emphasis and inline code", () => {
		expect(cleanTextForSpeech("This is **bold**, *italic* and `code`.")).toBe(
			"This is bold, italic and code."
		);
	});

	it("replaces fenced code blocks", () => {
		expect(cleanTextForSpeech("Before\n```js\nconsole.log(1)\n```\nAfter")).toContain(
			"code omitted"
		);
	});

	it("keeps link labels but drops URLs", () => {
		expect(cleanTextForSpeech("See [the docs](https://example.com) for more.")).toBe(
			"See the docs for more."
		);
	});

	it("removes list markers and headings", () => {
		expect(cleanTextForSpeech("# Title\n- item one\n2. item two")).toBe("Title item one item two");
	});
});
