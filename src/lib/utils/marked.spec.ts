import { describe, expect, test } from "vitest";
import { processBlocksSync, processTokensSync } from "./marked";

function renderHtml(md: string): string {
	const tokens = processTokensSync(md, []);
	const textToken = tokens.find((token) => token.type === "text");
	if (!textToken || textToken.type !== "text") return "";
	return typeof textToken.html === "string" ? textToken.html : "";
}

describe("marked basic rendering", () => {
	test("renders bold text", () => {
		const html = renderHtml("**bold**");
		expect(html).toContain("<strong>bold</strong>");
	});

	test("renders links", () => {
		const html = renderHtml("[link](https://example.com)");
		expect(html).toContain('<a href="https://example.com"');
		expect(html).toContain("link</a>");
	});

	test("renders paragraphs", () => {
		const html = renderHtml("hello world");
		expect(html).toContain("<p>hello world</p>");
	});
});

describe("marked image renderer", () => {
	test("renders video extensions as <video>", () => {
		const html = renderHtml("![](https://example.com/clip.mp4)");
		expect(html).toContain("<video controls");
		expect(html).toContain('<source src="https://example.com/clip.mp4">');
	});

	test("renders audio extensions as <audio>", () => {
		const html = renderHtml("![](https://example.com/clip.mp3)");
		expect(html).toContain("<audio controls");
		expect(html).toContain('<source src="https://example.com/clip.mp3">');
	});

	test("renders non-video images as <img>", () => {
		const html = renderHtml("![](https://example.com/pic.png)");
		expect(html).toContain('<img src="https://example.com/pic.png"');
	});

	test("renders video with query params", () => {
		const html = renderHtml("![](https://example.com/clip.mp4?token=abc)");
		expect(html).toContain("<video controls");
		expect(html).toContain("clip.mp4?token=abc");
	});
});

describe("marked html video tag support", () => {
	test("allows raw <video> tags with controls", () => {
		const html = renderHtml('<video controls src="https://example.com/video.mp4"></video>');
		expect(html).toContain("<video");
		expect(html).toContain("controls");
		expect(html).toContain('src="https://example.com/video.mp4"');
	});

	test("allows <video> with nested <source> tags", () => {
		const html = renderHtml(
			'<video controls><source src="https://example.com/video.webm" type="video/webm"></video>'
		);
		expect(html).toContain("<video");
		expect(html).toContain("<source");
		expect(html).toContain('src="https://example.com/video.webm"');
	});

	test("strips disallowed attributes from video tags", () => {
		const html = renderHtml('<video onclick="alert(1)" src="https://example.com/v.mp4"></video>');
		expect(html).toContain("<video");
		expect(html).not.toContain("onclick");
	});

	test("strips javascript: URLs from media sources", () => {
		const html = renderHtml('<video controls src="javascript:alert(1)"></video>');
		expect(html).not.toContain("javascript:");
	});

	test("escapes disallowed html tags", () => {
		const html = renderHtml("<script>alert(1)</script>");
		expect(html).not.toContain("<script>");
		expect(html).toContain("&lt;script&gt;");
	});

	test("allows <audio> tags with controls", () => {
		const html = renderHtml(
			'<audio controls><source src="https://example.com/audio.mp3" type="audio/mpeg"></audio>'
		);
		expect(html).toContain("<audio");
		expect(html).toContain("<source");
		expect(html).toContain('type="audio/mpeg"');
	});
});

describe("streaming incomplete markdown", () => {
	test("incomplete link renders as inert anchor, not a dead clickable link", () => {
		const html = renderHtml("Check [the docs](https://exam");
		expect(html).toContain("<a data-incomplete-link>the docs</a>");
		expect(html).not.toContain("streamdown:incomplete-link");
		expect(html).not.toContain("target=");
	});

	test("incomplete link text renders as inert anchor", () => {
		const html = renderHtml("Check [the doc");
		expect(html).toContain("<a data-incomplete-link>the doc</a>");
	});

	test("complete links keep their href", () => {
		const html = renderHtml("Check [the docs](https://example.com)");
		expect(html).toContain('<a href="https://example.com" target="_blank" rel="noreferrer">');
		expect(html).not.toContain("data-incomplete-link");
	});

	test("incomplete bold renders as bold", () => {
		const html = renderHtml("Some **important tex");
		expect(html).toContain("<strong>important tex</strong>");
	});

	test("incomplete inline code renders as code", () => {
		const html = renderHtml("Run `npm insta");
		expect(html).toContain("<code>npm insta</code>");
	});

	test("partial trailing HTML tag does not flash as raw text", () => {
		const html = renderHtml("Some text <video contro");
		expect(html).toContain("Some text");
		expect(html).not.toContain("video contro");
	});

	test("lone dash while a list streams in does not flash previous text as heading", () => {
		const html = renderHtml("Shopping list:\n-");
		expect(html).not.toContain("<h2>");
		expect(html).toContain("Shopping list:");
	});

	test("single tilde ranges do not flash as strikethrough", () => {
		const html = renderHtml("Heat to 20~25°C");
		expect(html).not.toContain("<del>");
		expect(html).toContain("20~25°C");
	});

	test("comparison operator in list items does not render a blockquote", () => {
		const html = renderHtml("- > 25: expensive");
		expect(html).not.toContain("<blockquote>");
		expect(html).toContain("&gt; 25: expensive");
	});
});

describe("processBlocksSync streaming behavior", () => {
	test("regex character classes in code do not collapse the document into one block", () => {
		const content = [
			"Match whitespace:",
			"",
			"```js",
			"const re = /[^\\s>]+/;",
			"```",
			"",
			"And some trailing explanation.",
		].join("\n");
		const blocks = processBlocksSync(content, []);
		expect(blocks.length).toBeGreaterThan(1);
	});

	test("block ids of completed blocks are stable while streaming", () => {
		const full = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.";
		const fullIds = processBlocksSync(full, []).map((b) => b.id);
		// Stream in the third paragraph: ids of the first two blocks must not change
		const partialIds = processBlocksSync(`${full.slice(0, -10)}`, []).map((b) => b.id);
		expect(partialIds.slice(0, -1)).toEqual(fullIds.slice(0, partialIds.length - 1));
	});
});
