import { describe, expect, it } from "vitest";
import parity from "./__fixtures__/fuzzyParity.json";
import {
	fullProcess,
	partialRatioScore,
	ratio,
	roundHalfEven,
	tokenSetRatio,
	tokenSetRatioAtLeast,
} from "./fuzzy";

/**
 * Scores captured from the Python original — `thefuzz` 0.22 on rapidfuzz 3.14 —
 * rather than from this implementation, which is the only reason the table can
 * catch a port that drifts. Regenerate by running the same pairs through
 * `thefuzz.fuzz.{token_set_ratio,partial_ratio,ratio}`.
 */
const rows = parity as Array<["t" | "p" | "r", string, string, number]>;

const score = (kind: string, a: string, b: string) =>
	kind === "t"
		? tokenSetRatio(a, b)
		: kind === "p"
			? partialRatioScore(a, b)
			: roundHalfEven(ratio(a, b));

const label = { t: "token_set_ratio", p: "partial_ratio", r: "ratio" } as const;

describe("fuzzy scorers", () => {
	it("reproduces every captured Python score", () => {
		const mismatches = rows
			.filter(([kind, a, b, expected]) => score(kind, a, b) !== expected)
			.map(
				([kind, a, b, expected]) =>
					`${label[kind]}(${JSON.stringify(a)}, ${JSON.stringify(b)}) = ${score(kind, a, b)}, expected ${expected}`
			);
		expect(mismatches).toEqual([]);
	});

	it("covers all three scorers", () => {
		expect(new Set(rows.map(([kind]) => kind))).toEqual(new Set(["t", "p", "r"]));
	});

	it("filters with tokenSetRatioAtLeast exactly as filtering the full score would", () => {
		// The cutoff is an optimisation; it must never change which pairs survive.
		for (const threshold of [0, 60, 80, 100]) {
			for (const [kind, a, b] of rows) {
				if (kind !== "t") continue;
				const full = tokenSetRatio(a, b);
				const cut = tokenSetRatioAtLeast(a, b, threshold);
				expect({ a, b, threshold, cut }).toEqual({
					a,
					b,
					threshold,
					cut: full >= threshold ? full : 0,
				});
			}
		}
	});
});

describe("fullProcess", () => {
	it("separates on underscore, unlike the fuzzywuzzy-era regex", () => {
		expect(fullProcess("use_cases")).toBe("use cases");
		expect(fullProcess("__init__.py")).toBe("init   py");
	});

	it("strips only Latin-1, leaving other scripts to be split on non-alphanumerics", () => {
		expect(fullProcess("café")).toBe("caf");
		expect(fullProcess("docs/日本語/readme.md")).toBe("docs 日本語 readme md");
		expect(fullProcess("emoji 😀 x")).toBe("emoji   x");
	});

	it("trims the ends without collapsing interior runs", () => {
		expect(fullProcess("  a\tb  c ")).toBe("a b  c");
	});
});

describe("tokenSetRatio", () => {
	it("scores a subset token set as an exact match", () => {
		// Why a threshold as low as 60 still behaves like a near-exact filter.
		expect(tokenSetRatio("scripts", "examples/scripts/sft.py")).toBe(100);
		expect(tokenSetRatio("use_cases", "src/use_cases/demo.py")).toBe(100);
	});

	it("does not treat a partial token as a member of the set", () => {
		expect(tokenSetRatio("script", "examples/scripts/sft.py")).toBeLessThan(100);
	});

	it("is zero when either side has no tokens", () => {
		expect(tokenSetRatio("", "examples/scripts/sft.py")).toBe(0);
		expect(tokenSetRatio("scripts", "")).toBe(0);
	});
});

describe("partialRatio", () => {
	it("finds a needle inside a path segment", () => {
		expect(partialRatioScore("grpo", "examples/scripts/grpo_trainer.py")).toBe(100);
	});

	it("works on raw strings, so separators stay significant", () => {
		expect(partialRatioScore("sft", "examples/scripts/sft.py")).toBe(100);
		expect(partialRatioScore("zzzznotathing", "examples/scripts/sft.py")).toBeLessThan(60);
	});

	it("is zero for an empty needle against a non-empty haystack", () => {
		expect(partialRatioScore("", "examples/scripts/sft.py")).toBe(0);
	});
});

describe("roundHalfEven", () => {
	it("rounds halves to even, as Python's round does", () => {
		// Math.round would give 83 and 89 — and exact halves do occur, since every
		// score is 2·LCS/(len₁+len₂).
		expect(roundHalfEven(82.5)).toBe(82);
		expect(roundHalfEven(83.5)).toBe(84);
		expect(roundHalfEven(88.5)).toBe(88);
		expect(roundHalfEven(89.4)).toBe(89);
		expect(roundHalfEven(89.6)).toBe(90);
	});
});
