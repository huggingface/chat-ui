import { describe, expect, it } from "vitest";
import {
	cleanTextForMeta,
	extractFirstUserPrompt,
	renderableThumbnailText,
} from "./sharePreviewText";
import type { Message } from "$lib/types/Message";

// Non-ASCII inputs are built from codepoints to keep this file ASCII-only
const cp = (...codepoints: number[]) => String.fromCodePoint(...codepoints);

const CJK_POEM = cp(0x5e2e, 0x6211, 0x5199, 0x4e00, 0x9996, 0x8bd7); // "help me write a poem"
const ARABIC = cp(0x0627, 0x0643, 0x062a, 0x0628, 0x0644, 0x064a, 0x0642, 0x0635, 0x0629);
const PARTY_POPPER = cp(0x1f389);
const RLO = cp(0x202e); // right-to-left override
const PDF_CHAR = cp(0x202c); // pop directional formatting
const ZWSP = cp(0x200b);
const ELLIPSIS = cp(0x2026);

describe("cleanTextForMeta", () => {
	it("collapses whitespace and newlines", () => {
		expect(cleanTextForMeta("a\n\nb\t c\r\nd", 100)).toBe("a b c d");
	});

	it("strips control characters and bidi overrides", () => {
		expect(cleanTextForMeta(`hello ${RLO}evil${PDF_CHAR} world${cp(0)}!`, 100)).toBe(
			"hello evil world !"
		);
	});

	it("strips zero-width characters", () => {
		expect(cleanTextForMeta(`zero${ZWSP}${ZWSP}width`, 100)).toBe("zero width");
	});

	it("keeps non-Latin scripts (for og: metadata)", () => {
		expect(cleanTextForMeta(CJK_POEM, 100)).toBe(CJK_POEM);
	});

	it("truncates on a word boundary with an ellipsis", () => {
		const out = cleanTextForMeta("word ".repeat(60), 50);
		expect(out.length).toBeLessThanOrEqual(51);
		expect(out.endsWith(ELLIPSIS)).toBe(true);
		expect(out).not.toContain("wor" + ELLIPSIS);
	});

	it("applies NFC normalization", () => {
		// "e" + combining acute accent becomes precomposed "é"
		expect(cleanTextForMeta("caf" + cp(0x65, 0x0301), 100)).toBe("caf" + cp(0xe9));
	});

	it("returns empty string for whitespace-only input", () => {
		expect(cleanTextForMeta("  \n\t  ", 100)).toBe("");
	});
});

describe("renderableThumbnailText", () => {
	it("keeps plain English prompts", () => {
		expect(renderableThumbnailText("How do I write a Python script?", 240)).toBe(
			"How do I write a Python script?"
		);
	});

	it("keeps HTML-looking text as literal text", () => {
		const input = '<script>alert(1)</script> & "quotes" <b>bold</b>';
		expect(renderableThumbnailText(input, 240)).toBe(input);
	});

	it("strips emoji", () => {
		expect(renderableThumbnailText(`Plan a party ${PARTY_POPPER} for my daughter`, 240)).toBe(
			"Plan a party for my daughter"
		);
	});

	it("returns empty string for text in non-renderable scripts", () => {
		expect(renderableThumbnailText(CJK_POEM, 240)).toBe("");
		expect(renderableThumbnailText(ARABIC, 240)).toBe("");
	});

	it("replaces non-renderable runs in mixed text with one ellipsis", () => {
		expect(renderableThumbnailText(`Translate ${CJK_POEM} to English for me please`, 240)).toBe(
			`Translate ${ELLIPSIS} to English for me please`
		);
	});

	it("keeps Latin-extended and Cyrillic scripts", () => {
		const vietnamese = `Vi${cp(0x1ebf)}t cho t${cp(0xf4)}i about spring please`;
		expect(renderableThumbnailText(vietnamese, 240)).toBe(vietnamese);
		const russian = cp(0x041d, 0x0430, 0x043f, 0x0438, 0x0448, 0x0438) + " please my friend";
		expect(renderableThumbnailText(russian, 240)).toBe(russian);
	});

	it("returns empty string when too little content remains", () => {
		expect(renderableThumbnailText("", 240)).toBe("");
		expect(renderableThumbnailText("   ", 240)).toBe("");
		expect(renderableThumbnailText("ok!", 240)).toBe("");
	});

	it("caps length", () => {
		const out = renderableThumbnailText("x".repeat(1000), 240);
		expect(out.length).toBeLessThanOrEqual(241);
	});
});

describe("extractFirstUserPrompt", () => {
	const msg = (
		id: string,
		from: Message["from"],
		content: string,
		children: string[] = []
	): Pick<Message, "id" | "from" | "content" | "children"> => ({ id, from, content, children });

	it("walks past the system root to the first user message", () => {
		const messages = [
			msg("sys", "system", "preprompt", ["u1"]),
			msg("u1", "user", "first prompt", ["a1"]),
			msg("a1", "assistant", "answer"),
		];
		expect(extractFirstUserPrompt(messages, "sys")).toBe("first prompt");
	});

	it("follows the first child branch", () => {
		const messages = [
			msg("sys", "system", "", ["u1", "u2"]),
			msg("u1", "user", "original prompt"),
			msg("u2", "user", "edited prompt"),
		];
		expect(extractFirstUserPrompt(messages, "sys")).toBe("original prompt");
	});

	it("falls back to array order without a root id", () => {
		const messages = [msg("a1", "assistant", "hi"), msg("u1", "user", "the prompt")];
		expect(extractFirstUserPrompt(messages)).toBe("the prompt");
	});

	it("skips user messages with empty content", () => {
		const messages = [
			msg("sys", "system", "", ["u1"]),
			msg("u1", "user", "   ", ["u2"]),
			msg("u2", "user", "real prompt"),
		];
		expect(extractFirstUserPrompt(messages, "sys")).toBe("real prompt");
	});

	it("terminates on cyclic trees", () => {
		const messages = [msg("a", "assistant", "x", ["b"]), msg("b", "assistant", "y", ["a"])];
		expect(extractFirstUserPrompt(messages, "a")).toBe("");
	});

	it("returns empty string for empty conversations", () => {
		expect(extractFirstUserPrompt([])).toBe("");
	});
});
