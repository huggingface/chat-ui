import { describe, expect, it } from "vitest";
import type { ReviewComment } from "$lib/types/MlReview";
import {
	anchorLabel,
	areaBetween,
	formatClock,
	formatTime,
	pinNumbers,
	timeCovers,
} from "./anchors";

const comment = (id: string, extra: Partial<ReviewComment> = {}): ReviewComment => ({
	id,
	body: "x",
	createdAt: new Date(0),
	...extra,
});

describe("formatClock", () => {
	it("prints m:ss under an hour and h:mm:ss above", () => {
		expect(formatClock(12.7)).toBe("0:12");
		expect(formatClock(75)).toBe("1:15");
		expect(formatClock(3723)).toBe("1:02:03");
	});

	it("adds tenths for the player clock", () => {
		expect(formatClock(8.14, { tenths: true })).toBe("0:08.1");
	});

	it("treats a missing duration as zero", () => {
		expect(formatClock(Number.NaN)).toBe("0:00");
	});
});

describe("anchorLabel", () => {
	it("matches the result text the server writes", () => {
		expect(anchorLabel({ area: { x: 0.31, y: 0.06, w: 0.49, h: 0.12 } })).toBe(
			"area 31%,6% 49%x12%"
		);
		expect(anchorLabel({ time: { start: 12, end: 18 } })).toBe("0:12-0:18");
		expect(anchorLabel({ time: { start: 12 } })).toBe("0:12");
		expect(anchorLabel({ time: { start: 12 }, area: { x: 0.31, y: 0.06, w: 0.49, h: 0.12 } })).toBe(
			"0:12 area 31%,6% 49%x12%"
		);
		expect(anchorLabel({})).toBeUndefined();
	});

	it("prints a range", () => {
		expect(formatTime({ start: 61, end: 3601 })).toBe("1:01-1:00:01");
	});
});

describe("areaBetween", () => {
	it("spans two corners in either direction and stays inside the stage", () => {
		expect(areaBetween({ x: 0.8, y: 0.5 }, { x: 0.2, y: 1.4 })).toEqual({
			x: 0.2,
			y: 0.5,
			w: 0.6,
			h: 0.5,
		});
	});

	it("rounds to 4 decimals", () => {
		expect(areaBetween({ x: 0.123456, y: 0 }, { x: 0.5, y: 0.333333 })).toEqual({
			x: 0.1235,
			y: 0,
			w: 0.3765,
			h: 0.3333,
		});
	});

	it("never reaches past the edge once rounded", () => {
		const area = areaBetween({ x: 0.12345, y: 0.00005 }, { x: 1, y: 1 });
		expect(area.x + area.w).toBeLessThanOrEqual(1);
		expect(area.y + area.h).toBeLessThanOrEqual(1);
	});
});

describe("timeCovers", () => {
	it("holds a moment briefly and a range throughout", () => {
		expect(timeCovers({ start: 2 }, 2.1)).toBe(true);
		expect(timeCovers({ start: 2 }, 3)).toBe(false);
		expect(timeCovers({ start: 2, end: 4 }, 3)).toBe(true);
		expect(timeCovers(undefined, 99)).toBe(true);
	});
});

describe("pinNumbers", () => {
	it("numbers only anchored comments, in order", () => {
		const numbers = pinNumbers([
			comment("a", { time: { start: 1 } }),
			comment("b"),
			comment("c", { area: { x: 0, y: 0, w: 0.5, h: 0.5 } }),
		]);
		expect([...numbers]).toEqual([
			["a", 1],
			["c", 2],
		]);
	});
});
