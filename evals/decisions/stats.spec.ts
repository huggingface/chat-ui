import { describe, expect, it } from "vitest";
import { holm, permutationP } from "./stats";

describe("holm", () => {
	it("scales the smallest p by the number of tests and keeps the order monotone", () => {
		expect(holm([0.01, 0.04, null, 0.03])).toEqual([0.03, 0.06, null, 0.06]);
	});
});

describe("permutationP", () => {
	it("finds no difference between arms that got the same verdicts", () => {
		const cases = Array.from({ length: 6 }, (_, i) => ({
			conversationId: String(i),
			a: [true, false, true],
			b: [true, false, true],
		}));
		expect(permutationP(cases, 200)).toBe(1);
	});

	it("finds a difference when one arm always passes and the other never does", () => {
		const cases = Array.from({ length: 6 }, (_, i) => ({
			conversationId: String(i),
			a: [false, false, false],
			b: [true, true, true],
		}));
		expect(permutationP(cases, 2000)).toBeLessThan(0.01);
	});
});
