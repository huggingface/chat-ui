import { describe, expect, it } from "vitest";
import {
	anchorMinHeight,
	bottomClearance,
	ANCHOR_TOP_OFFSET_PX,
	COMPOSER_CLEARANCE_PX,
	MIN_CLEARANCE_PX,
} from "./geometry";

describe("bottomClearance", () => {
	it("falls back to the historical clearance when the composer is unmeasured", () => {
		expect(bottomClearance(undefined)).toBe(MIN_CLEARANCE_PX);
		expect(bottomClearance(0)).toBe(MIN_CLEARANCE_PX);
	});

	it("keeps the fallback while the composer fits under it", () => {
		expect(bottomClearance(100)).toBe(MIN_CLEARANCE_PX);
	});

	it("tracks a tall composer plus clearance so content is never occluded", () => {
		expect(bottomClearance(300)).toBe(300 + COMPOSER_CLEARANCE_PX);
		expect(bottomClearance(500)).toBe(500 + COMPOSER_CLEARANCE_PX);
	});
});

describe("anchorMinHeight", () => {
	it("reserves the viewport minus the anchor offset and the clearance", () => {
		expect(anchorMinHeight(800, MIN_CLEARANCE_PX)).toBe(800 - ANCHOR_TOP_OFFSET_PX - 208);
	});

	it("trades exactly 1:1 against the clearance (constant page height mid-fill)", () => {
		const at = (clearance: number) => anchorMinHeight(800, clearance) + clearance;
		expect(at(208)).toBe(at(324));
		expect(at(208)).toBe(at(500));
	});

	it("never goes negative on tiny viewports", () => {
		expect(anchorMinHeight(120, MIN_CLEARANCE_PX)).toBe(0);
		expect(anchorMinHeight(0, 0)).toBe(0);
	});
});
