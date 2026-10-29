/**
 * Whether a change made the agent's decisions worse, from a comparison of its arm (B) against a
 * base (A). Runs on demand or on a schedule, not on every PR: a full comparison takes hours.
 *
 * Agreed 2026-10-29 after six A/A comparisons (four identical arms) flagged no family once Holm
 * was applied, where uncorrected p-values and the pooled row did:
 * - the four families are the tests; the pooled row mixes their baselines and is not one
 * - a family worse in B with Holm-adjusted p < 0.05 is a regression
 * - an improvement is claimed only for the family the change named before running, at p < 0.05
 * - before any of that, the arms must be comparable: the prompt differs, and neither the share of
 *   samples without a verdict nor the judge's agreement with labels.ts moved by more than 10
 *   points, either of which means the judge is reading the arms differently. Below the full size
 *   the limit widens to 2.5 standard errors: in the A/A runs (20–45 samples per family) agreement
 *   moved up to 16 points by chance
 */
import type { Family } from "./types";

export const FULL_SIZE = { perFamily: 20, samples: 10 };
const ALPHA = 0.05;
const MAX_DRIFT = 0.1;

export interface FamilyResult {
	diff: number | null;
	p: number | null;
	pHolm: number | null;
	unjudgedShare: { a: number | null; b: number | null };
	agreement: { a: number | null; b: number | null };
	/** what each share above was taken over */
	counts: { samples: Pair; agreement: Pair };
}

type Pair = { a: number; b: number };

export interface ShipInput {
	samePromptCases: number;
	sharedCases: number;
	size: { perFamily: number; samples: number };
	/** the family the change set out to improve, named before the run */
	target?: Family;
	families: Partial<Record<Family, FamilyResult>>;
}

export interface ShipVerdict {
	verdict: "pass" | "regression" | "inconclusive" | "no-change";
	/** null without a target, or when the target was not run */
	improved: boolean | null;
	/** false below the agreed size: the verdict is then a preview */
	fullSize: boolean;
	reasons: string[];
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function shipVerdict(input: ShipInput): ShipVerdict {
	const fullSize =
		input.size.perFamily >= FULL_SIZE.perFamily && input.size.samples >= FULL_SIZE.samples;
	const sizeNote = fullSize
		? []
		: [
				`below the full size (${input.size.perFamily} cases × ${input.size.samples} samples, ` +
					`agreed ${FULL_SIZE.perFamily} × ${FULL_SIZE.samples}): a preview`,
			];
	if (input.sharedCases > 0 && input.samePromptCases === input.sharedCases) {
		return {
			verdict: "no-change",
			improved: null,
			fullSize,
			reasons: ["both arms sent the same prompt and tools in every case", ...sizeNote],
		};
	}

	const entries = Object.entries(input.families) as Array<[Family, FamilyResult]>;
	const drift = entries.flatMap(([family, r]) => {
		const check = (x: { a: number | null; b: number | null }, n: Pair, what: string) => {
			if (x.a === null || x.b === null || !n.a || !n.b) return "";
			const pooled = (x.a * n.a + x.b * n.b) / (n.a + n.b);
			const se = Math.sqrt(pooled * (1 - pooled) * (1 / n.a + 1 / n.b));
			const limit = Math.max(MAX_DRIFT, 2.5 * se);
			const moved = Math.abs(x.b - x.a);
			return moved > limit ? `${family}: ${what} moved ${pct(moved)} (limit ${pct(limit)})` : "";
		};
		return [
			check(r.unjudgedShare, r.counts.samples, "share without a verdict"),
			check(r.agreement, r.counts.agreement, "judge agreement with labels.ts"),
		].filter(Boolean);
	});
	const regressed = entries
		.filter(([, r]) => r.diff !== null && r.diff < 0 && r.pHolm !== null && r.pHolm < ALPHA)
		.map(([family, r]) => `${family} is worse: ${pct(r.diff as number)}, Holm p = ${r.pHolm}`);
	const target = input.target ? input.families[input.target] : undefined;
	const improved = target
		? target.diff !== null && target.diff > 0 && target.p !== null && target.p < ALPHA
		: null;
	const targetNote =
		input.target && target
			? [
					improved
						? `${input.target} improved: +${pct(target.diff as number)}, p = ${target.p}`
						: `${input.target} did not show an improvement (diff ${target.diff === null ? "–" : pct(target.diff)}, p = ${target.p ?? "–"})`,
				]
			: input.target
				? [`${input.target} was not in this run`]
				: [];

	// reported even when the comparison is shaky: a false alarm costs a look, a missed one a release
	if (regressed.length)
		return {
			verdict: "regression",
			improved,
			fullSize,
			reasons: [...regressed, ...drift, ...sizeNote],
		};
	if (drift.length)
		return {
			verdict: "inconclusive",
			improved,
			fullSize,
			reasons: [...drift, ...targetNote, ...sizeNote],
		};
	return {
		verdict: "pass",
		improved,
		fullSize,
		reasons: ["no family is worse", ...targetNote, ...sizeNote],
	};
}
