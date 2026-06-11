import type { AbortedGeneration } from "$lib/types/AbortedGeneration";

/**
 * Content to persist for a user-stopped generation.
 *
 * The stopping client freezes its UI the moment Stop is clicked and reports
 * the stop point (generation id + rendered character count) on the abort
 * marker. Tokens keep arriving server-side until the marker is observed — or
 * much longer when the stop request itself is delayed or retried — so without
 * this clamp the interrupted message "grows back" past what the user saw on
 * the next sync.
 *
 * The clamp is bounded below by the pre-generation prefix (continue flows
 * append to existing content) and above by what was actually generated.
 * Markers for another generation, legacy stop requests without a stop point,
 * and non-finite lengths leave the content unchanged.
 */
export function clampStoppedContent(opts: {
	content: string;
	initialLength: number;
	generationId: string | undefined;
	marker: Pick<AbortedGeneration, "generationId" | "seenContentLength"> | null;
}): string {
	const { content, initialLength, generationId, marker } = opts;
	const seen = marker?.seenContentLength;
	if (
		generationId === undefined ||
		marker?.generationId !== generationId ||
		typeof seen !== "number" ||
		!Number.isFinite(seen)
	) {
		return content;
	}
	const keepUpTo = Math.max(initialLength, Math.min(content.length, Math.floor(seen)));
	return content.slice(0, keepUpTo);
}
