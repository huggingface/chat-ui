import { describe, expect, it } from "vitest";
import {
	renderShareThumbnailPng,
	SHARE_THUMBNAIL_WIDTH,
	SHARE_THUMBNAIL_HEIGHT,
} from "./shareThumbnail";
import { renderableThumbnailText } from "$lib/utils/sharePreviewText";

const cp = (...codepoints: number[]) => String.fromCodePoint(...codepoints);

function expectValidPng(png: Uint8Array) {
	// PNG signature
	expect(Array.from(png.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	// IHDR width/height (big-endian at offsets 16 and 20)
	const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
	expect(view.getUint32(16)).toBe(SHARE_THUMBNAIL_WIDTH);
	expect(view.getUint32(20)).toBe(SHARE_THUMBNAIL_HEIGHT);
}

describe("renderShareThumbnailPng", () => {
	it("renders a PNG for a normal prompt", async () => {
		const png = await renderShareThumbnailPng({
			prompt: renderableThumbnailText("How do I fine-tune a model on my own dataset?", 240),
			modelName: "moonshotai/Kimi-K2-Thinking",
			isHuggingChat: true,
			appName: "HuggingChat",
		});
		expectValidPng(png);
	});

	it("renders the generic card when the prompt is empty", async () => {
		const png = await renderShareThumbnailPng({
			prompt: "",
			modelName: "",
			isHuggingChat: false,
			appName: "ChatUI",
		});
		expectValidPng(png);
	});

	it("renders adversarial prompts without fetching or throwing", async () => {
		const inputs = [
			// HTML/markup must stay inert text (no parsing, no server-side fetches)
			'<script>alert(1)</script> <img src="https://evil.example/x.png"> &lt;x&gt; &#60;y&#62;',
			// emoji + CJK mix
			`Plan a party ${cp(0x1f389)} and translate ${cp(0x4f60, 0x597d)} please`,
			// unbroken long token
			"https://example.com/" + "a".repeat(220),
			// maximum-length sanitized text
			"lorem ipsum ".repeat(40),
		];
		for (const input of inputs) {
			const png = await renderShareThumbnailPng({
				prompt: renderableThumbnailText(input, 240),
				modelName: "openai/gpt-oss-120b",
				isHuggingChat: true,
				appName: "HuggingChat",
			});
			expectValidPng(png);
		}
	}, 30000);
});
