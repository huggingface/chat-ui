/** mulberry32, so a stored seed reads the same rows again */
export function seededRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export const randomSeed = () => Math.floor(Math.random() * 2 ** 31);

export interface RowWindow {
	offset: number;
	length: number;
}

export function headWindow(total: number, rows: number, offset = 0): RowWindow[] {
	const start = Math.min(offset, total);
	const length = Math.min(rows, total - start);
	return length > 0 ? [{ offset: start, length }] : [];
}

/** one seeded window per stratum, the viewer rate limits and a parquet row costs its whole chunk */
export function randomWindows(
	total: number,
	rows: number,
	maxWindows: number,
	seed: number
): RowWindow[] {
	if (rows >= total) return headWindow(total, total);
	const per = Math.ceil(rows / Math.max(1, Math.min(maxWindows, rows)));
	// from per, so the last strata are drawn from too
	const count = Math.ceil(rows / per);
	const random = seededRandom(seed);
	const windows: RowWindow[] = [];
	let left = rows;
	for (let i = 0; i < count && left > 0; i += 1) {
		const start = Math.floor((i * total) / count);
		const span = Math.floor(((i + 1) * total) / count) - start;
		const length = Math.min(per, left, span);
		if (length <= 0) continue;
		windows.push({ offset: start + Math.floor(random() * (span - length + 1)), length });
		left -= length;
	}
	return windows;
}

export const VIEWER_PAGE_ROWS = 100;

export function splitWindows(windows: RowWindow[], max = VIEWER_PAGE_ROWS): RowWindow[] {
	return windows.flatMap((window) => {
		const parts: RowWindow[] = [];
		for (let at = 0; at < window.length; at += max) {
			parts.push({ offset: window.offset + at, length: Math.min(max, window.length - at) });
		}
		return parts;
	});
}

export async function mapPool<T, R>(
	items: T[],
	concurrency: number,
	fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
	const out: R[] = new Array(items.length);
	let next = 0;
	const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
		while (next < items.length) {
			const index = next++;
			out[index] = await fn(items[index], index);
		}
	});
	await Promise.all(workers);
	return out;
}
