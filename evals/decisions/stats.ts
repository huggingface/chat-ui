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
