import { describe, expect, it } from "vitest";
import {
	computeSpacerHeight,
	minSpacerHeight,
	COMPOSER_CLEARANCE_PX,
	MIN_SPACER_FALLBACK_PX,
	SPACER_TOP_OFFSET_PX,
} from "./spacer";

describe("computeSpacerHeight", () => {
	const base = {
		viewportHeight: 800,
		minSpacer: MIN_SPACER_FALLBACK_PX,
		topOffset: SPACER_TOP_OFFSET_PX,
	};

	it("fills the viewport below a fresh short turn, leaving the top offset", () => {
		// 60px user message + 0px empty assistant between anchor and spacer.
		expect(computeSpacerHeight({ ...base, anchorToSpacer: 60 })).toBe(800 - 60 - 50);
	});

	it("shrinks 1:1 as the reply grows (constant total height through the fill phase)", () => {
		const at = (grown: number) => computeSpacerHeight({ ...base, anchorToSpacer: 60 + grown });
		expect(at(0) - at(120)).toBe(120);
		expect(at(120) - at(300)).toBe(180);
	});

	it("clamps to the floor once content exceeds the viewport", () => {
		expect(computeSpacerHeight({ ...base, anchorToSpacer: 900 })).toBe(MIN_SPACER_FALLBACK_PX);
	});

	it("clamps for a user message taller than the viewport", () => {
		expect(computeSpacerHeight({ ...base, anchorToSpacer: 1200 })).toBe(MIN_SPACER_FALLBACK_PX);
	});

	it("respects a raised floor from a tall composer even in the fill phase", () => {
		expect(computeSpacerHeight({ ...base, anchorToSpacer: 500, minSpacer: 400 })).toBe(400);
	});

	it("handles tiny viewports by falling through to the floor", () => {
		expect(computeSpacerHeight({ ...base, viewportHeight: 120, anchorToSpacer: 60 })).toBe(
			MIN_SPACER_FALLBACK_PX
		);
	});
});

describe("minSpacerHeight", () => {
	it("falls back to the historical clearance when the composer is unmeasured", () => {
		expect(minSpacerHeight(undefined)).toBe(MIN_SPACER_FALLBACK_PX);
		expect(minSpacerHeight(0)).toBe(MIN_SPACER_FALLBACK_PX);
	});

	it("keeps the fallback while the composer fits under it", () => {
		expect(minSpacerHeight(100)).toBe(MIN_SPACER_FALLBACK_PX);
	});

	it("tracks a tall composer plus clearance so content is never occluded", () => {
		expect(minSpacerHeight(300)).toBe(300 + COMPOSER_CLEARANCE_PX);
		expect(minSpacerHeight(500)).toBe(500 + COMPOSER_CLEARANCE_PX);
	});
});
