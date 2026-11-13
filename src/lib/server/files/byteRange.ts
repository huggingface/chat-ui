/**
 * A `Range` header (`bytes=a-b`, `bytes=a-` or `bytes=-n`) as an inclusive
 * [start, end] within `size` bytes. Only single ranges are served; `null`
 * means no header, `"bad"` an unsatisfiable or malformed one (answer 416).
 */
export function parseByteRange(
	header: string | null,
	size: number
): [number, number] | null | "bad" {
	if (!header) return null;
	const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (!m || (m[1] === "" && m[2] === "")) return "bad";
	let start: number;
	let end: number;
	if (m[1] === "") {
		const suffix = Number(m[2]);
		if (suffix === 0) return "bad";
		start = Math.max(0, size - suffix);
		end = size - 1;
	} else {
		start = Number(m[1]);
		end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
	}
	return start <= end && start < size ? [start, end] : "bad";
}
