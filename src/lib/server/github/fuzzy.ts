/**
 * The two fuzzy scorers the GitHub grounding tools rank with, ported from
 * `thefuzz` (which delegates to rapidfuzz) so the thresholds the Python original
 * was tuned against keep their meaning.
 *
 * Parity is not incidental here. `fuse.js` and friends score on a different
 * model entirely, and a scorer that merely "looks similar" would quietly move
 * every cutoff in `findExamples.ts`. The ports below follow rapidfuzz's
 * `fuzz_py.py` line for line, and `fuzzy.spec.ts` pins them against scores
 * captured from the Python implementation.
 */

/**
 * `thefuzz` returns `int(round(score))`, and Python's `round` is half-to-even —
 * so 82.5 is 82, not 83. Exact halves do occur (any score of the form
 * 2·LCS/(len₁+len₂) with a power-of-two denominator), so `Math.round` would
 * disagree on real inputs.
 */
export function roundHalfEven(value: number): number {
	const floor = Math.floor(value);
	const diff = value - floor;
	if (diff > 0.5) return floor + 1;
	if (diff < 0.5) return floor;
	return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * `thefuzz`'s `full_process`: its `ascii_only` pass, then rapidfuzz's
 * `default_process`.
 *
 * Two details are easy to get wrong and both change scores on real paths:
 *
 * - `ascii_only` strips only U+0080–U+00FF, not everything above ASCII. `café`
 *   loses its `é`; a CJK or emoji path segment reaches `default_process` intact.
 * - `default_process` separates on anything that is not a letter or a number,
 *   which includes `_`. The older fuzzywuzzy `\W` regex kept underscores, so a
 *   port written against fuzzywuzzy scores `use_cases` differently.
 */
export function fullProcess(value: string): string {
	return (
		value
			.replace(/[\u0080-\u00ff]/g, "")
			.replace(/[^\p{L}\p{N}]/gu, " ")
			.trim()
			// rapidfuzz lowercases per code point, so U+0130 becomes a bare "i".
			// JS applies full Unicode case mapping and expands it to "i" plus a
			// combining dot, which is a different token and a different score.
			.replace(/\u0130/g, "i")
			.toLowerCase()
	);
}

/** Code points rather than UTF-16 units, so a path with an astral character aligns as Python does. */
const chars = (value: string): string[] => Array.from(value);

/**
 * Length of the longest common subsequence. The Indel (insert/delete) distance
 * every scorer here is built on is `len(a) + len(b) - 2 · lcs`.
 */
function lcsLength(a: string[], b: string[]): number {
	if (a.length === 0 || b.length === 0) return 0;
	// Rolling single row: the scorers below run this over every path in a repo tree.
	let previous = new Uint32Array(b.length + 1);
	let current = new Uint32Array(b.length + 1);
	for (let i = 1; i <= a.length; i++) {
		const ai = a[i - 1];
		for (let j = 1; j <= b.length; j++) {
			current[j] =
				ai === b[j - 1]
					? previous[j - 1] + 1
					: current[j - 1] > previous[j]
						? current[j - 1]
						: previous[j];
		}
		const swap = previous;
		previous = current;
		current = swap;
		current.fill(0);
	}
	return previous[b.length];
}

/**
 * `maxDistance` is rapidfuzz's `score_cutoff` on the distance: when the true
 * distance exceeds it the exact value does not matter, so a length difference
 * alone is enough to answer "too far" without running the LCS. Callers only ever
 * compare the result against `maxDistance`, so the shortcut changes no outcome.
 */
function indelDistance(a: string[], b: string[], maxDistance?: number): number {
	if (maxDistance !== undefined && Math.abs(a.length - b.length) > maxDistance) {
		return maxDistance + 1;
	}
	return a.length + b.length - 2 * lcsLength(a, b);
}

/**
 * `100 - 100·dist/lensum`, zeroed when it falls under the cutoff — rapidfuzz's
 * `_norm_distance`. Two empty strings score 100 rather than dividing by zero.
 */
function normDistance(dist: number, lensum: number, scoreCutoff: number): number {
	const score = lensum ? 100 - (100 * dist) / lensum : 100;
	return score >= scoreCutoff ? score : 0;
}

/** rapidfuzz `fuzz.ratio`: normalized Indel similarity, 0–100. Unprocessed inputs. */
export function ratio(a: string, b: string): number {
	const ca = chars(a);
	const cb = chars(b);
	return normDistance(indelDistance(ca, cb), ca.length + cb.length, 0);
}

/**
 * rapidfuzz `_partial_ratio_impl`, assuming `needle.length <= haystack.length`.
 * Scores the best alignment of the needle against every window of the haystack
 * that could be optimal: the leading partial windows, the full-width ones, and
 * the trailing partial windows. Returns 0–1.
 *
 * The `needleChars` guard is rapidfuzz's, not an optimisation of ours — it skips
 * a window whose decisive character cannot match at all, and it is load-bearing
 * for parity because a skipped window is a window that never scores.
 */
function partialRatioImpl(needle: string[], haystack: string[], scoreCutoff: number): number {
	const len1 = needle.length;
	const len2 = haystack.length;
	if (len1 === 0) return 0;

	const needleChars = new Set(needle);
	let best = 0;
	let cutoff = scoreCutoff;

	const consider = (start: number, end: number): boolean => {
		const window = haystack.slice(start, end);
		const similarity =
			normDistance(indelDistance(needle, window), len1 + window.length, cutoff * 100) / 100;
		if (similarity > best) {
			best = similarity;
			cutoff = similarity;
			return similarity === 1;
		}
		return false;
	};

	for (let i = 1; i < len1; i++) {
		if (!needleChars.has(haystack[i - 1])) continue;
		if (consider(0, i)) return 1;
	}
	for (let i = 0; i < len2 - len1; i++) {
		if (!needleChars.has(haystack[i + len1 - 1])) continue;
		if (consider(i, i + len1)) return 1;
	}
	for (let i = Math.max(0, len2 - len1); i < len2; i++) {
		if (!needleChars.has(haystack[i])) continue;
		if (consider(i, len2)) return 1;
	}
	return best;
}

/**
 * rapidfuzz `fuzz.partial_ratio`, 0–100, on raw (unprocessed) strings — which is
 * exactly why callers lowercase by hand: the separators in a path stay intact,
 * and that is what lets a needle match inside a path segment.
 */
export function partialRatio(a: string, b: string): number {
	if (!a && !b) return 100;
	const ca = chars(a);
	const cb = chars(b);
	const [shorter, longer] = ca.length <= cb.length ? [ca, cb] : [cb, ca];

	let score = partialRatioImpl(shorter, longer, 0) * 100;
	// Equal lengths make "shorter" arbitrary, so rapidfuzz tries the other order too.
	if (score !== 100 && ca.length === cb.length) {
		const swapped = partialRatioImpl(longer, shorter, score / 100) * 100;
		if (swapped > score) score = swapped;
	}
	return score;
}

/**
 * rapidfuzz `fuzz.token_set_ratio` on already-processed input: compare the two
 * strings as *sets* of whitespace-separated tokens.
 *
 * The consequence worth knowing is the early exit — when one token set is a
 * subset of the other the score is 100 outright. That is why a threshold as low
 * as 60 still behaves like a near-exact filter for a single-word pattern: it
 * either appears as a whole token in the path and scores 100, or it does not and
 * scores whatever the raw string similarity happens to be.
 */
function tokenSetRatioProcessed(a: string, b: string, scoreCutoff = 0): number {
	const tokensA = new Set(a.split(/\s+/).filter(Boolean));
	const tokensB = new Set(b.split(/\s+/).filter(Boolean));
	if (tokensA.size === 0 || tokensB.size === 0) return 0;

	const intersect: string[] = [];
	const diffAb: string[] = [];
	for (const token of tokensA) (tokensB.has(token) ? intersect : diffAb).push(token);
	const diffBa = [...tokensB].filter((token) => !tokensA.has(token));

	if (intersect.length && (!diffAb.length || !diffBa.length)) return 100;

	const joinedAb = chars(diffAb.sort().join(" "));
	const joinedBa = chars(diffBa.sort().join(" "));
	const abLen = joinedAb.length;
	const baLen = joinedBa.length;
	// Length of the intersection joined by single spaces, without building the string.
	const sect = intersect.length
		? intersect.reduce((sum, token) => sum + chars(token).length, 0) + intersect.length - 1
		: 0;
	const separator = sect !== 0 ? 1 : 0;

	const sectAbLen = sect + separator + abLen;
	const sectBaLen = sect + separator + baLen;

	const cutoffDistance = Math.ceil((sectAbLen + sectBaLen) * (1 - scoreCutoff / 100));
	const dist = indelDistance(joinedAb, joinedBa, cutoffDistance);
	const result =
		dist <= cutoffDistance ? normDistance(dist, sectAbLen + sectBaLen, scoreCutoff) : 0;
	if (!sect) return result;

	// sect is a prefix of both combined strings, so these two distances are just
	// the length difference — no alignment needed.
	const sectAbRatio = normDistance(separator + abLen, sect + sectAbLen, scoreCutoff);
	const sectBaRatio = normDistance(separator + baLen, sect + sectBaLen, scoreCutoff);
	return Math.max(result, sectAbRatio, sectBaRatio);
}

/** `thefuzz.fuzz.token_set_ratio`: `full_process` both sides, then round half-to-even. */
export function tokenSetRatio(a: string, b: string): number {
	return roundHalfEven(tokenSetRatioProcessed(fullProcess(a), fullProcess(b)));
}

/**
 * `tokenSetRatio` for the filtering case: the score, or 0 when it cannot reach
 * `threshold`. Identical results to filtering the full score by hand, but it
 * skips the alignment for pairs that are obviously too far apart — which is most
 * of them when every pattern is scored against every path in a repo tree.
 *
 * The cutoff sits half a point below the threshold because the caller compares
 * the *rounded* score: a true 59.5 rounds to 60 and must survive a threshold of 60.
 */
export function tokenSetRatioAtLeast(a: string, b: string, threshold: number): number {
	const score = tokenSetRatioProcessed(
		fullProcess(a),
		fullProcess(b),
		Math.max(0, threshold - 0.5)
	);
	return score === 0 ? 0 : roundHalfEven(score);
}

/** `thefuzz.fuzz.partial_ratio`: no preprocessing, then round half-to-even. */
export function partialRatioScore(a: string, b: string): number {
	return roundHalfEven(partialRatio(a, b));
}
