import { describe, expect, it, vi } from "vitest";
import { getActiveAnnouncement } from "./featureAnnouncements";

const NOW = new Date("2026-06-10T12:00:00.000Z");

const announcement = (overrides: Record<string, unknown> = {}) => ({
	title: "Introducing Artifacts",
	description: "Apps, docs and diagrams rendered live in a side panel.",
	...overrides,
});

describe("getActiveAnnouncement", () => {
	it("returns undefined when unset or blank", () => {
		expect(getActiveAnnouncement(undefined, NOW)).toBeUndefined();
		expect(getActiveAnnouncement("", NOW)).toBeUndefined();
		expect(getActiveAnnouncement("   ", NOW)).toBeUndefined();
	});

	it("returns undefined for malformed or non-array values", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			expect(getActiveAnnouncement("not json", NOW)).toBeUndefined();
			expect(getActiveAnnouncement('{"title":"obj"}', NOW)).toBeUndefined();
			expect(getActiveAnnouncement("[]", NOW)).toBeUndefined();
		} finally {
			warn.mockRestore();
		}
	});

	it("returns a valid announcement with trimmed fields", () => {
		const raw = JSON.stringify([
			announcement({ title: "  Introducing Artifacts  ", link: "https://hf.co/blog" }),
		]);
		expect(getActiveAnnouncement(raw, NOW)).toEqual({
			title: "Introducing Artifacts",
			description: "Apps, docs and diagrams rendered live in a side panel.",
			link: "https://hf.co/blog",
			cta: undefined,
		});
	});

	it("keeps a trimmed cta label when provided", () => {
		const raw = JSON.stringify([
			announcement({ link: "/models/google/gemma-4-31B-it", cta: "  Go to the model  " }),
		]);
		expect(getActiveAnnouncement(raw, NOW)?.cta).toBe("Go to the model");
	});

	it("leaves cta undefined when missing or blank", () => {
		const raw = JSON.stringify([announcement({ cta: "   " })]);
		expect(getActiveAnnouncement(raw, NOW)?.cta).toBeUndefined();
	});

	it("takes the last valid entry", () => {
		const raw = JSON.stringify([
			announcement({ title: "Old feature" }),
			announcement({ title: "New feature" }),
		]);
		expect(getActiveAnnouncement(raw, NOW)?.title).toBe("New feature");
	});

	it("skips entries missing a title or description", () => {
		const raw = JSON.stringify([
			announcement({ title: "Valid entry" }),
			announcement({ title: "" }),
			announcement({ description: undefined }),
			"not an object",
		]);
		expect(getActiveAnnouncement(raw, NOW)?.title).toBe("Valid entry");
	});

	it("skips expired entries and falls back to an earlier valid one", () => {
		const raw = JSON.stringify([
			announcement({ title: "Evergreen" }),
			announcement({ title: "Expired", maxDate: "2026-06-01" }),
		]);
		expect(getActiveAnnouncement(raw, NOW)?.title).toBe("Evergreen");
	});

	it("keeps entries whose maxDate is in the future", () => {
		const raw = JSON.stringify([announcement({ maxDate: "2026-07-01T00:00:00.000Z" })]);
		expect(getActiveAnnouncement(raw, NOW)).toBeDefined();
	});

	it("treats a date-only maxDate as inclusive of that whole day (UTC)", () => {
		const raw = JSON.stringify([announcement({ maxDate: "2026-06-10" })]);
		expect(getActiveAnnouncement(raw, new Date("2026-06-10T23:00:00.000Z"))).toBeDefined();
		expect(getActiveAnnouncement(raw, new Date("2026-06-11T00:00:00.000Z"))).toBeUndefined();
	});

	it("fails closed on an unparseable maxDate", () => {
		const raw = JSON.stringify([announcement({ maxDate: "soon" })]);
		expect(getActiveAnnouncement(raw, NOW)).toBeUndefined();
	});

	it("drops unsafe or invalid links but keeps the announcement", () => {
		for (const link of ["javascript:alert(1)", "not a url", 42]) {
			const raw = JSON.stringify([announcement({ link })]);
			const active = getActiveAnnouncement(raw, NOW);
			expect(active).toBeDefined();
			expect(active?.link).toBeUndefined();
		}
	});

	it("keeps app-relative links", () => {
		const raw = JSON.stringify([announcement({ link: "/settings" })]);
		expect(getActiveAnnouncement(raw, NOW)?.link).toBe("/settings");
	});

	it("accepts JSON5 syntax and backtick-wrapped values", () => {
		const raw = "`[{title: 'Hello', description: 'World',}]`";
		expect(getActiveAnnouncement(raw, NOW)).toEqual({
			title: "Hello",
			description: "World",
			link: undefined,
		});
	});
});
