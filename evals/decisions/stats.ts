const DRAWS = 2000;

export interface Interval {
	value: number | null;
	low: number | null;
	high: number | null;
}

const round = (x: number) => Number(x.toFixed(3));

/**
 * A statistic with a 95% interval from resampling whole groups, since items from one conversation
 * are not independent.
 */
export function bootstrap<T>(
	groups: T[][],
	statistic: (items: T[]) => number | null,
	draws = DRAWS
): Interval {
	const value = statistic(groups.flat());
	if (value === null || groups.length === 0) return { value, low: null, high: null };
	const results: number[] = [];
	for (let i = 0; i < draws; i++) {
		const drawn = Array.from(
			{ length: groups.length },
			() => groups[Math.floor(Math.random() * groups.length)]
		).flat();
		const result = statistic(drawn);
		if (result !== null) results.push(result);
	}
	results.sort((a, b) => a - b);
	return {
		value: round(value),
		low: round(results[Math.floor(results.length * 0.025)]),
		high: round(results[Math.floor(results.length * 0.975)]),
	};
}

export function groupBy<T>(items: T[], key: (item: T) => string): T[][] {
	const groups = new Map<string, T[]>();
	for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
	return [...groups.values()];
}

export const mean = (values: number[]): number | null =>
	values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

/** one case in a paired comparison: each arm's verdicts on its samples */
export interface PairedCase {
	conversationId: string;
	a: boolean[];
	b: boolean[];
}

const share = (verdicts: boolean[]) => verdicts.filter(Boolean).length / verdicts.length;
const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];
const resample = <T>(list: T[]) => Array.from({ length: list.length }, () => pick(list));

/** mean over cases of each arm's right-call share, and of b − a */
function pairedMeans(cases: PairedCase[]) {
	return {
		a: mean(cases.map((c) => share(c.a))),
		b: mean(cases.map((c) => share(c.b))),
		diff: mean(cases.map((c) => share(c.b) - share(c.a))),
	};
}

/**
 * Intervals that carry both sources of noise: which conversations were drawn, and which samples
 * each arm happened to get within a case. Resampling cases alone treats each case's few samples
 * as exact, and an A/A run then shows "effects" that are sampling luck.
 */
export function pairedBootstrap(cases: PairedCase[], draws = DRAWS) {
	const groups = groupBy(cases, (c) => c.conversationId);
	const observed = pairedMeans(cases);
	const results = { a: [] as number[], b: [] as number[], diff: [] as number[] };
	for (let i = 0; i < draws; i++) {
		const drawn = resample(groups)
			.flat()
			.map((c) => ({ ...c, a: resample(c.a), b: resample(c.b) }));
		const m = pairedMeans(drawn);
		for (const k of ["a", "b", "diff"] as const) if (m[k] !== null) results[k].push(m[k] as number);
	}
	const interval = (k: "a" | "b" | "diff"): Interval => {
		const value = observed[k];
		if (value === null) return { value: null, low: null, high: null };
		const sorted = results[k].sort((x, y) => x - y);
		return {
			value: round(value),
			low: round(sorted[Math.floor(sorted.length * 0.025)]),
			high: round(sorted[Math.floor(sorted.length * 0.975)]),
		};
	};
	return { a: interval("a"), b: interval("b"), diff: interval("diff") };
}

/**
 * Two-sided p for "the arms differ": with no difference, each case's samples could have come
 * from either arm, so they are reshuffled between arms within the case.
 */
export function permutationP(cases: PairedCase[], iterations = 5000): number | null {
	const observed = pairedMeans(cases).diff;
	if (observed === null) return null;
	let extreme = 0;
	for (let i = 0; i < iterations; i++) {
		const shuffled = cases.map((c) => {
			const pooled = [...c.a, ...c.b].sort(() => Math.random() - 0.5);
			return { ...c, a: pooled.slice(0, c.a.length), b: pooled.slice(c.a.length) };
		});
		const diff = pairedMeans(shuffled).diff ?? 0;
		if (Math.abs(diff) >= Math.abs(observed) - 1e-12) extreme += 1;
	}
	return Number(((extreme + 1) / (iterations + 1)).toFixed(4));
}
