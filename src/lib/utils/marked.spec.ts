import { describe, expect, test } from "vitest";

import { processTokensSync } from "./marked";

function renderHtml(md: string): string {
	const tokens = processTokensSync(md, []);
	const textToken = tokens.find((token) => token.type === "text");
	if (!textToken || textToken.type !== "text") return "";
	return typeof textToken.html === "string" ? textToken.html : "";
}

describe("marked image renderer", () => {
	test("renders video extensions as <video>", () => {
		const html = renderHtml("![](https://example.com/clip.mp4)");
		expect(html).toContain("<video controls");
		expect(html).toContain('<source src="https://example.com/clip.mp4">');
	});

	test("renders non-video images as <img>", () => {
		const html = renderHtml("![](https://example.com/pic.png)");
		expect(html).toContain('<img src="https://example.com/pic.png"');
	});
});
