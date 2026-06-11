import { describe, expect, it } from "vitest";

import { clampStoppedContent } from "$lib/server/stopTruncation";

const GEN_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_GEN_ID = "22222222-2222-4222-8222-222222222222";

describe("clampStoppedContent", () => {
	it("clamps generated text to the reported stop point", () => {
		expect(
			clampStoppedContent({
				content: "0123456789",
				initialLength: 0,
				generationId: GEN_ID,
				marker: { generationId: GEN_ID, seenContentLength: 4 },
			})
		).toBe("0123");
	});

	it("never cuts into the pre-generation prefix (continue flows)", () => {
		expect(
			clampStoppedContent({
				content: "prefix-and-more",
				initialLength: 7,
				generationId: GEN_ID,
				marker: { generationId: GEN_ID, seenContentLength: 3 },
			})
		).toBe("prefix-");
	});

	it("leaves content unchanged when the stop point exceeds the generated text", () => {
		expect(
			clampStoppedContent({
				content: "short",
				initialLength: 0,
				generationId: GEN_ID,
				marker: { generationId: GEN_ID, seenContentLength: 50 },
			})
		).toBe("short");
	});

	it("ignores markers without a stop point (legacy stops)", () => {
		expect(
			clampStoppedContent({
				content: "0123456789",
				initialLength: 0,
				generationId: GEN_ID,
				marker: {},
			})
		).toBe("0123456789");
	});

	it("ignores stop points from another generation run", () => {
		expect(
			clampStoppedContent({
				content: "0123456789",
				initialLength: 0,
				generationId: GEN_ID,
				marker: { generationId: OTHER_GEN_ID, seenContentLength: 4 },
			})
		).toBe("0123456789");
	});

	it("ignores markers when the run has no generation id", () => {
		expect(
			clampStoppedContent({
				content: "0123456789",
				initialLength: 0,
				generationId: undefined,
				marker: { generationId: GEN_ID, seenContentLength: 4 },
			})
		).toBe("0123456789");
	});

	it("returns content unchanged without a marker", () => {
		expect(
			clampStoppedContent({
				content: "0123456789",
				initialLength: 0,
				generationId: GEN_ID,
				marker: null,
			})
		).toBe("0123456789");
	});

	it("floors fractional stop points and clamps negative ones to the prefix", () => {
		expect(
			clampStoppedContent({
				content: "0123456789",
				initialLength: 0,
				generationId: GEN_ID,
				marker: { generationId: GEN_ID, seenContentLength: 4.9 },
			})
		).toBe("0123");
		expect(
			clampStoppedContent({
				content: "0123456789",
				initialLength: 2,
				generationId: GEN_ID,
				marker: { generationId: GEN_ID, seenContentLength: -3 },
			})
		).toBe("01");
	});

	it("ignores non-finite stop points", () => {
		expect(
			clampStoppedContent({
				content: "0123456789",
				initialLength: 0,
				generationId: GEN_ID,
				marker: { generationId: GEN_ID, seenContentLength: Number.NaN },
			})
		).toBe("0123456789");
	});
});
