import { afterEach, describe, expect, it, vi } from "vitest";

// TEXT_MIME_ALLOWLIST is resolved once at module load from $env/dynamic/public,
// so each case re-mocks the env and re-imports the module.
async function loadAllowlist(allowlistEnv?: string) {
	vi.resetModules();
	vi.doMock("$env/dynamic/public", () => ({
		env: allowlistEnv === undefined ? {} : { PUBLIC_TEXT_MIME_ALLOWLIST: allowlistEnv },
	}));

	return import("./mime");
}

describe("TEXT_MIME_ALLOWLIST", () => {
	afterEach(() => {
		vi.doUnmock("$env/dynamic/public");
		vi.resetModules();
	});

	it("falls back to the defaults when the env var is unset", async () => {
		const { TEXT_MIME_ALLOWLIST, TEXT_MIME_ALLOWLIST_DEFAULT } = await loadAllowlist();
		expect(TEXT_MIME_ALLOWLIST).toEqual([...TEXT_MIME_ALLOWLIST_DEFAULT]);
	});

	it("falls back to the defaults when the env var is empty", async () => {
		const { TEXT_MIME_ALLOWLIST, TEXT_MIME_ALLOWLIST_DEFAULT } = await loadAllowlist("");
		expect(TEXT_MIME_ALLOWLIST).toEqual([...TEXT_MIME_ALLOWLIST_DEFAULT]);
	});

	it("appends extra types to the defaults", async () => {
		const { TEXT_MIME_ALLOWLIST, TEXT_MIME_ALLOWLIST_DEFAULT } = await loadAllowlist(
			"text/x-typescript,text/x-python"
		);
		expect(TEXT_MIME_ALLOWLIST).toEqual([
			...TEXT_MIME_ALLOWLIST_DEFAULT,
			"text/x-typescript",
			"text/x-python",
		]);
	});

	it("trims whitespace and ignores empty entries", async () => {
		const { TEXT_MIME_ALLOWLIST, TEXT_MIME_ALLOWLIST_DEFAULT } = await loadAllowlist(
			" text/x-typescript , , text/x-python ,"
		);
		expect(TEXT_MIME_ALLOWLIST).toEqual([
			...TEXT_MIME_ALLOWLIST_DEFAULT,
			"text/x-typescript",
			"text/x-python",
		]);
	});

	it("supports wildcard patterns so they match through mimeMatchesAllowlist", async () => {
		const { TEXT_MIME_ALLOWLIST } = await loadAllowlist("application/*");
		const { mimeMatchesAllowlist } = await import("$lib/utils/mimeMatch");

		expect(mimeMatchesAllowlist("application/x-yaml", TEXT_MIME_ALLOWLIST)).toBe(true);
		expect(mimeMatchesAllowlist("image/png", TEXT_MIME_ALLOWLIST)).toBe(false);
	});

	it("lowercases entries so the case-sensitive client matcher still matches", async () => {
		const { TEXT_MIME_ALLOWLIST } = await loadAllowlist("Application/X-Yaml");
		const { mimeMatchesAllowlist } = await import("$lib/utils/mimeMatch");

		expect(TEXT_MIME_ALLOWLIST).toContain("application/x-yaml");
		expect(mimeMatchesAllowlist("application/x-yaml", TEXT_MIME_ALLOWLIST)).toBe(true);
	});
});
