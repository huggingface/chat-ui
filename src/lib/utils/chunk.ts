/**
 * Types of chunk units
 */
type ChunkType = "characters" | "words";

/**
 * Chunk array or string into arrays of length at most `chunkSize` based on the specified `chunkType`
 *
 * @param chunkSize must be greater than or equal to 1
 * @param chunkType specifies whether to chunk by "characters" or "words"
 */
export function chunk<T extends unknown[] | string>(
	arr: T,
	chunkSize: number,
	chunkType: ChunkType = "characters"
): T[] {
	if (isNaN(chunkSize) || chunkSize < 1) {
		throw new RangeError("Invalid chunk size: " + chunkSize);
	}

	if (!arr.length) {
		return [];
	}

	if (typeof arr === "string" && chunkType === "words") {
		const words = arr.split(/\s+/);
		if (words.length <= chunkSize) {
			return [arr] as T[];
		}

		return range(Math.ceil(words.length / chunkSize)).map((i) => {
			const _chunk = words.slice(i * chunkSize, (i + 1) * chunkSize).join(" ");
			return _chunk as unknown as T;
		});
	}

	if (arr.length <= chunkSize) {
		return [arr];
	}

	return range(Math.ceil(arr.length / chunkSize)).map((i) => {
		return arr.slice(i * chunkSize, (i + 1) * chunkSize) as unknown as T;
	});
}

function range(n: number, b?: number): number[] {
	return b
		? Array(b - n)
				.fill(0)
				.map((_, i) => n + i)
		: Array(n)
				.fill(0)
				.map((_, i) => i);
}
