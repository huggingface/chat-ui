import { describe, expect, it } from "vitest";
import { headWindow, mapPool, randomWindows, seededRandom, splitWindows } from "./sampling";

const rowsOf = (windows: { length: number }[]) => windows.reduce((sum, w) => sum + w.length, 0);

describe("review sampling", () => {
	it("reads the same rows again from the same seed", () => {
		expect(randomWindows(1_400_000, 50, 20, 42)).toEqual(randomWindows(1_400_000, 50, 20, 42));
		expect(randomWindows(1_400_000, 50, 20, 42)).not.toEqual(randomWindows(1_400_000, 50, 20, 43));
		const random = seededRandom(7);
		expect(Array.from({ length: 3 }, random)).toEqual(Array.from({ length: 3 }, seededRandom(7)));
	});

	it("spreads a random sample over the whole split in a bounded number of windows", () => {
		for (const rows of [1, 10, 50, 499, 500]) {
			const windows = randomWindows(1_400_000, rows, 20, 9);
			expect(windows.length).toBeLessThanOrEqual(20);
			expect(rowsOf(windows)).toBe(rows);
			for (const [i, w] of windows.entries()) {
				expect(w.offset).toBeGreaterThanOrEqual(Math.floor((i * 1_400_000) / windows.length));
				expect(w.offset + w.length).toBeLessThanOrEqual(1_400_000);
			}
		}
		const fifty = randomWindows(1_400_000, 50, 20, 9);
		expect(fifty[fifty.length - 1].offset).toBeGreaterThan(1_300_000);
	});

	it("never overlaps two windows or runs past the end on a small split", () => {
		const windows = randomWindows(30, 25, 20, 3);
		expect(rowsOf(windows)).toBe(25);
		const seen = new Set<number>();
		for (const w of windows) {
			for (let r = w.offset; r < w.offset + w.length; r += 1) {
				expect(seen.has(r)).toBe(false);
				seen.add(r);
			}
		}
		expect(Math.max(...seen)).toBeLessThan(30);
	});

	it("takes every row when the sample is the whole split", () => {
		expect(randomWindows(12, 50, 20, 1)).toEqual([{ offset: 0, length: 12 }]);
		expect(headWindow(12, 50)).toEqual([{ offset: 0, length: 12 }]);
		expect(headWindow(12, 5, 10)).toEqual([{ offset: 10, length: 2 }]);
		expect(headWindow(12, 5, 20)).toEqual([]);
	});

	it("splits a window into viewer pages of 100 rows", () => {
		expect(splitWindows([{ offset: 50, length: 250 }])).toEqual([
			{ offset: 50, length: 100 },
			{ offset: 150, length: 100 },
			{ offset: 250, length: 50 },
		]);
	});

	it("keeps results in order whatever order the work finishes in", async () => {
		const out = await mapPool([30, 10, 20], 2, async (ms, i) => {
			await new Promise((resolve) => setTimeout(resolve, ms));
			return i;
		});
		expect(out).toEqual([0, 1, 2]);
	});
});
