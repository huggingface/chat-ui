import { describe, expect, it } from "vitest";
import { mimeMatchesAllowlist } from "$lib/utils/mime";
import { CLIPBOARD_MIME, TEXT_MIME_ALLOWLIST } from "$lib/constants/mime";
import { isAllowedUploadMime } from "$lib/server/files/validateUploadMime";

describe("mimeMatchesAllowlist", () => {
	it("matches wildcard subtypes", () => {
		expect(mimeMatchesAllowlist("image/png", ["image/*"])).toBe(true);
	});

	it("rejects non-matching subtypes", () => {
		expect(mimeMatchesAllowlist("image/png", ["image/jpeg"])).toBe(false);
	});

	it("matches text/csv against the text allowlist", () => {
		expect(mimeMatchesAllowlist("text/csv", TEXT_MIME_ALLOWLIST)).toBe(true);
	});

	it("strips mime parameters before matching", () => {
		expect(mimeMatchesAllowlist("text/csv; charset=utf-8", TEXT_MIME_ALLOWLIST)).toBe(true);
	});

	it("is case-insensitive", () => {
		expect(mimeMatchesAllowlist("APPLICATION/JSON", TEXT_MIME_ALLOWLIST)).toBe(true);
	});

	it("rejects an empty mime", () => {
		expect(mimeMatchesAllowlist("", TEXT_MIME_ALLOWLIST)).toBe(false);
	});
});

describe("isAllowedUploadMime", () => {
	it("allows PDFs", () => {
		expect(isAllowedUploadMime("application/pdf")).toBe(true);
	});

	it("allows the synthetic clipboard mime", () => {
		expect(isAllowedUploadMime(CLIPBOARD_MIME)).toBe(true);
	});

	it("rejects image/webp without a model allowlist but accepts it with image/*", () => {
		expect(isAllowedUploadMime("image/webp")).toBe(false);
		expect(isAllowedUploadMime("image/webp", ["image/*"])).toBe(true);
	});

	it("rejects archives", () => {
		expect(isAllowedUploadMime("application/zip")).toBe(false);
	});

	it("allows an empty mime (unknown extensions; content is sniffed at upload)", () => {
		expect(isAllowedUploadMime("")).toBe(true);
	});
});
