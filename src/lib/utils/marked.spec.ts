import { describe, test, expect } from "vitest";

// =============================================================================
// Video Sanitization Tests
//
// These tests verify the security and correctness of HTML video tag sanitization.
// The sanitization exists to allow models to output <video> tags in markdown
// while preventing XSS attacks and other security issues.
// =============================================================================

// Import the internal functions we need to test
// Note: These need to be exported from marked.ts for testing
import { escapeHTML, isSafeMediaUrl, sanitizeVideoHtml, parseAttributes } from "./marked";

// =============================================================================
// escapeHTML: Prevents XSS by converting special characters to HTML entities
// =============================================================================
describe("escapeHTML", () => {
	test("escapes all dangerous characters", () => {
		expect(escapeHTML("<script>alert('xss')</script>")).toBe(
			"&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;"
		);
	});

	test("escapes quotes for attribute injection prevention", () => {
		expect(escapeHTML('" onload="alert(1)')).toBe("&quot; onload=&quot;alert(1)");
	});

	test("escapes ampersands", () => {
		expect(escapeHTML("a & b")).toBe("a &amp; b");
	});

	test("leaves safe text unchanged", () => {
		expect(escapeHTML("Hello world 123")).toBe("Hello world 123");
	});
});

// =============================================================================
// isSafeMediaUrl: Validates URLs to prevent javascript: and data: injection
// =============================================================================
describe("isSafeMediaUrl", () => {
	test("allows https URLs", () => {
		expect(isSafeMediaUrl("https://example.com/video.mp4")).toBe("https://example.com/video.mp4");
	});

	test("allows http URLs", () => {
		expect(isSafeMediaUrl("http://example.com/video.mp4")).toBe("http://example.com/video.mp4");
	});

	test("allows absolute paths", () => {
		expect(isSafeMediaUrl("/videos/clip.mp4")).toBe("/videos/clip.mp4");
	});

	test("allows relative paths with ./", () => {
		expect(isSafeMediaUrl("./video.mp4")).toBe("./video.mp4");
	});

	test("allows parent relative paths", () => {
		expect(isSafeMediaUrl("../assets/video.mp4")).toBe("../assets/video.mp4");
	});

	test("blocks javascript: URLs", () => {
		expect(isSafeMediaUrl("javascript:alert(1)")).toBeUndefined();
	});

	test("blocks javascript: with mixed case", () => {
		expect(isSafeMediaUrl("JavaScript:alert(1)")).toBeUndefined();
	});

	test("blocks data: URLs", () => {
		expect(isSafeMediaUrl("data:text/html,<script>alert(1)</script>")).toBeUndefined();
	});

	test("trims whitespace", () => {
		expect(isSafeMediaUrl("  https://example.com/video.mp4  ")).toBe(
			"https://example.com/video.mp4"
		);
	});

	test("returns undefined for empty string", () => {
		expect(isSafeMediaUrl("")).toBeUndefined();
	});

	test("returns undefined for undefined input", () => {
		expect(isSafeMediaUrl(undefined)).toBeUndefined();
	});

	test("blocks bare filenames (potential path traversal)", () => {
		expect(isSafeMediaUrl("video.mp4")).toBeUndefined();
	});
});

// =============================================================================
// parseAttributes: Extracts attributes from HTML tag strings
// =============================================================================
describe("parseAttributes", () => {
	test("parses double-quoted attributes", () => {
		const attrs = parseAttributes('src="video.mp4" type="video/mp4"');
		expect(attrs.src).toBe("video.mp4");
		expect(attrs.type).toBe("video/mp4");
	});

	test("parses single-quoted attributes", () => {
		const attrs = parseAttributes("src='video.mp4'");
		expect(attrs.src).toBe("video.mp4");
	});

	test("parses unquoted attributes", () => {
		const attrs = parseAttributes("width=640 height=480");
		expect(attrs.width).toBe("640");
		expect(attrs.height).toBe("480");
	});

	test("parses boolean attributes", () => {
		const attrs = parseAttributes("controls autoplay muted");
		expect(attrs.controls).toBe(true);
		expect(attrs.autoplay).toBe(true);
		expect(attrs.muted).toBe(true);
	});

	test("handles mixed attribute styles", () => {
		const attrs = parseAttributes('controls src="vid.mp4" width=640');
		expect(attrs.controls).toBe(true);
		expect(attrs.src).toBe("vid.mp4");
		expect(attrs.width).toBe("640");
	});
});

// =============================================================================
// sanitizeVideoHtml: Main sanitization function
//
// Purpose: Allow safe video embeds while blocking XSS vectors like:
// - Event handlers (onerror, onload)
// - Dangerous URL schemes (javascript:, data:)
// - Arbitrary attributes
// =============================================================================
describe("sanitizeVideoHtml", () => {
	// --- Valid video tags that should pass through ---

	test("allows basic video with controls", () => {
		const input = '<video controls><source src="https://example.com/v.mp4"></video>';
		const result = sanitizeVideoHtml(input);
		expect(result).toBe('<video controls><source src="https://example.com/v.mp4"></video>');
	});

	test("allows video with multiple boolean attributes", () => {
		const input = "<video controls autoplay loop muted playsinline></video>";
		const result = sanitizeVideoHtml(input);
		expect(result).toContain("controls");
		expect(result).toContain("autoplay");
		expect(result).toContain("loop");
		expect(result).toContain("muted");
		expect(result).toContain("playsinline");
	});

	test("allows video with poster attribute", () => {
		const input = '<video poster="https://example.com/thumb.jpg"></video>';
		const result = sanitizeVideoHtml(input);
		expect(result).toContain('poster="https://example.com/thumb.jpg"');
	});

	test("allows video with width and height", () => {
		const input = '<video width="640" height="480"></video>';
		const result = sanitizeVideoHtml(input);
		expect(result).toContain('width="640"');
		expect(result).toContain('height="480"');
	});

	test("allows multiple source elements", () => {
		const input = `<video controls>
			<source src="https://example.com/v.webm" type="video/webm">
			<source src="https://example.com/v.mp4" type="video/mp4">
		</video>`;
		const result = sanitizeVideoHtml(input);
		expect(result).toContain('src="https://example.com/v.webm"');
		expect(result).toContain('src="https://example.com/v.mp4"');
		expect(result).toContain('type="video/webm"');
		expect(result).toContain('type="video/mp4"');
	});

	test("preserves fallback text", () => {
		const input = "<video controls>Your browser does not support video.</video>";
		const result = sanitizeVideoHtml(input);
		expect(result).toContain("Your browser does not support video.");
	});

	// --- Security: Attribute stripping ---

	test("strips onerror attribute (XSS prevention)", () => {
		const input = '<video onerror="alert(1)" controls></video>';
		const result = sanitizeVideoHtml(input);
		expect(result).not.toContain("onerror");
		expect(result).toContain("controls");
	});

	test("strips onload attribute", () => {
		const input = '<video onload="alert(1)"></video>';
		const result = sanitizeVideoHtml(input);
		expect(result).not.toContain("onload");
	});

	test("strips style attribute", () => {
		const input = '<video style="position:fixed;top:0;left:0;width:100vw"></video>';
		const result = sanitizeVideoHtml(input);
		expect(result).not.toContain("style");
	});

	test("strips class and id attributes", () => {
		const input = '<video class="evil" id="bad"></video>';
		const result = sanitizeVideoHtml(input);
		expect(result).not.toContain("class=");
		expect(result).not.toContain("id=");
	});

	// --- Security: URL sanitization ---

	test("blocks javascript: in poster URL", () => {
		const input = '<video poster="javascript:alert(1)"></video>';
		const result = sanitizeVideoHtml(input);
		expect(result).not.toContain("poster");
		expect(result).not.toContain("javascript");
	});

	test("blocks javascript: in source src", () => {
		const input = '<video><source src="javascript:alert(1)"></video>';
		const result = sanitizeVideoHtml(input);
		expect(result).not.toContain("javascript");
		// Source should be stripped entirely
		expect(result).toBe("<video></video>");
	});

	test("blocks data: URLs in source", () => {
		const input = '<video><source src="data:video/mp4,AAAA"></video>';
		const result = sanitizeVideoHtml(input);
		expect(result).not.toContain("data:");
		expect(result).toBe("<video></video>");
	});

	// --- Invalid inputs ---

	test("returns null for non-video HTML", () => {
		expect(sanitizeVideoHtml("<div>not a video</div>")).toBeNull();
		expect(sanitizeVideoHtml("<script>alert(1)</script>")).toBeNull();
		expect(sanitizeVideoHtml("<iframe src='evil.com'></iframe>")).toBeNull();
	});

	test("returns null for malformed video tags", () => {
		expect(sanitizeVideoHtml("<video>unclosed")).toBeNull();
		expect(sanitizeVideoHtml("video controls></video>")).toBeNull();
	});

	test("returns null for empty string", () => {
		expect(sanitizeVideoHtml("")).toBeNull();
	});

	// --- Edge cases ---

	test("handles video tag with no attributes", () => {
		const input = "<video></video>";
		const result = sanitizeVideoHtml(input);
		expect(result).toBe("<video></video>");
	});

	test("rejects invalid width/height values", () => {
		const input = '<video width="abc" height="-10"></video>';
		const result = sanitizeVideoHtml(input);
		expect(result).not.toContain("width");
		expect(result).not.toContain("height");
	});

	test("rejects non-video mime types in source", () => {
		const input = '<video><source src="https://x.com/v.mp4" type="text/html"></video>';
		const result = sanitizeVideoHtml(input);
		// Source should be included but without invalid type
		expect(result).toContain('src="https://x.com/v.mp4"');
		expect(result).not.toContain('type="text/html"');
	});

	test("escapes HTML in fallback text", () => {
		const input = "<video><script>alert(1)</script></video>";
		const result = sanitizeVideoHtml(input);
		expect(result).toContain("&lt;script&gt;");
		expect(result).not.toContain("<script>");
	});
});
