import { describe, expect, it } from "vitest";
import { shipVerdict, type FamilyResult, type ShipInput } from "./verdict";

const steady: FamilyResult = {
	diff: 0.02,
	p: 0.6,
	pHolm: 1,
	unjudgedShare: { a: 0.1, b: 0.12 },
	agreement: { a: 0.88, b: 0.86 },
	counts: { samples: { a: 200, b: 200 }, agreement: { a: 150, b: 150 } },
};
const input = (over: Partial<ShipInput> = {}): ShipInput => ({
	samePromptCases: 0,
	sharedCases: 80,
	size: { perFamily: 20, samples: 10 },
	families: {
		"first-gpu-job": steady,
		"after-job-failure": steady,
		"after-oom": steady,
		"after-stale-api": steady,
	},
	...over,
});

describe("shipVerdict", () => {
	it("passes when no family is worse after Holm", () => {
		expect(shipVerdict(input())).toMatchObject({ verdict: "pass", improved: null, fullSize: true });
	});

	it("does not flag an uncorrected p alone", () => {
		const families = {
			...input().families,
			"after-oom": { ...steady, diff: -0.15, p: 0.04, pHolm: 0.16 },
		};
		expect(shipVerdict(input({ families })).verdict).toBe("pass");
	});

	it("flags a family that is worse after Holm", () => {
		const families = {
			...input().families,
			"after-oom": { ...steady, diff: -0.2, p: 0.004, pHolm: 0.016 },
		};
		const result = shipVerdict(input({ families }));
		expect(result.verdict).toBe("regression");
		expect(result.reasons[0]).toContain("after-oom is worse");
	});

	it("credits only the named target, without correction", () => {
		const families = {
			...input().families,
			"after-job-failure": { ...steady, diff: 0.12, p: 0.03, pHolm: 0.12 },
		};
		expect(shipVerdict(input({ families, target: "after-job-failure" })).improved).toBe(true);
		expect(shipVerdict(input({ families, target: "first-gpu-job" })).improved).toBe(false);
		expect(shipVerdict(input({ families })).improved).toBeNull();
	});

	it("calls arms with the same prompt everywhere no change", () => {
		expect(shipVerdict(input({ samePromptCases: 80 })).verdict).toBe("no-change");
	});

	it("is inconclusive when the judge reads the arms differently", () => {
		const families = {
			...input().families,
			"first-gpu-job": { ...steady, unjudgedShare: { a: 0.05, b: 0.3 } },
		};
		expect(shipVerdict(input({ families })).verdict).toBe("inconclusive");
	});

	it("allows more drift in a small run, where chance moves agreement further", () => {
		const drifted = { ...steady, agreement: { a: 0.88, b: 0.74 } };
		const small = {
			...drifted,
			counts: { samples: { a: 50, b: 50 }, agreement: { a: 25, b: 25 } },
		};
		const families = (r: FamilyResult) => ({ ...input().families, "after-stale-api": r });
		expect(shipVerdict(input({ families: families(drifted) })).verdict).toBe("inconclusive");
		expect(shipVerdict(input({ families: families(small) })).verdict).toBe("pass");
	});

	it("marks a run below the agreed size as a preview", () => {
		const result = shipVerdict(input({ size: { perFamily: 10, samples: 5 } }));
		expect(result.fullSize).toBe(false);
		expect(result.reasons.at(-1)).toContain("preview");
	});
});
