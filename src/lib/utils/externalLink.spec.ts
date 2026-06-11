import { describe, expect, it } from "vitest";
import { parseExternalUrl } from "./externalLink";

describe("parseExternalUrl", () => {
	it("accepts absolute http(s) URLs", () => {
		expect(parseExternalUrl("https://huggingface.co/models")?.href).toBe(
			"https://huggingface.co/models"
		);
		expect(parseExternalUrl("http://example.com/a?b=c#d")?.href).toBe("http://example.com/a?b=c#d");
	});

	it("rejects non-http(s) schemes", () => {
		expect(parseExternalUrl("javascript:alert(1)")).toBeUndefined();
		expect(parseExternalUrl("data:text/html,<script>alert(1)</script>")).toBeUndefined();
		expect(parseExternalUrl("mailto:someone@example.com")).toBeUndefined();
		expect(parseExternalUrl("file:///etc/passwd")).toBeUndefined();
		expect(parseExternalUrl("vbscript:msgbox")).toBeUndefined();
	});

	it("rejects URLs with embedded credentials", () => {
		expect(parseExternalUrl("https://user:pass@example.com/path")).toBeUndefined();
		expect(parseExternalUrl("https://user@example.com/")).toBeUndefined();
		expect(parseExternalUrl("https://huggingface.co@evil.com/")).toBeUndefined();
	});

	it("rejects relative and malformed URLs", () => {
		expect(parseExternalUrl("/models/foo")).toBeUndefined();
		expect(parseExternalUrl("models/foo")).toBeUndefined();
		expect(parseExternalUrl("#anchor")).toBeUndefined();
		expect(parseExternalUrl("https://")).toBeUndefined();
		expect(parseExternalUrl("")).toBeUndefined();
	});

	it("rejects non-string values", () => {
		expect(parseExternalUrl(undefined)).toBeUndefined();
		expect(parseExternalUrl(null)).toBeUndefined();
		expect(parseExternalUrl(42)).toBeUndefined();
		expect(parseExternalUrl({ href: "https://example.com" })).toBeUndefined();
	});
});
