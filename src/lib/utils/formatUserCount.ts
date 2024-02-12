export function formatUserCount(userCount: number): string {
	const userCountRanges: { min: number; max: number; label: string }[] = [
		{ min: 0, max: 1, label: "1" },
		{ min: 2, max: 9, label: "1-10" },
		{ min: 10, max: 49, label: "10+" },
		{ min: 50, max: 99, label: "50+" },
		{ min: 100, max: 299, label: "100+" },
		{ min: 300, max: 499, label: "300+" },
		{ min: 500, max: 999, label: "500+" },
		{ min: 1_000, max: 2_999, label: "1k+" },
		{ min: 3_000, max: 4_999, label: "3k+" },
		{ min: 5_000, max: 9_999, label: "5k+" },
		{ min: 10_000, max: Infinity, label: "10k+" },
	];

	const range = userCountRanges.find(({ min, max }) => userCount >= min && userCount <= max);
	return range?.label ?? "";
}
