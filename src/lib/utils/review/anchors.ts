import type { ReviewArea, ReviewComment, ReviewField, ReviewTime } from "$lib/types/MlReview";

/** the server keeps 4 decimals, rounding here keeps a resave from changing the draft */
const AREA_DECIMALS = 4;
/** a drag smaller than this, as a fraction of the stage, is a click */
export const MIN_AREA = 0.01;

export type MediaFieldType = "audio" | "video";

export const isMediaField = (field: ReviewField): field is ReviewField & { type: MediaFieldType } =>
	field.type === "audio" || field.type === "video";

const round = (n: number, decimals: number) => {
	const scale = 10 ** decimals;
	return Math.round(n * scale) / scale;
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** the box two corners span, in either drag direction, kept inside the stage */
export function areaBetween(a: { x: number; y: number }, b: { x: number; y: number }): ReviewArea {
	const edge = (n: number) => round(clamp01(n), AREA_DECIMALS);
	const x = edge(Math.min(a.x, b.x));
	const y = edge(Math.min(a.y, b.y));
	// widths from rounded edges, rounding x and w apart can push x + w past 1 and the server refuses it
	return {
		x,
		y,
		w: round(edge(Math.max(a.x, b.x)) - x, AREA_DECIMALS),
		h: round(edge(Math.max(a.y, b.y)) - y, AREA_DECIMALS),
	};
}

export const timeAt = (seconds: number) => round(Math.max(0, seconds), 2);

/** m:ss under an hour and h:mm:ss above, tenths for the player clock */
export function formatClock(seconds: number, { tenths = false } = {}): string {
	const total = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
	const whole = Math.floor(total);
	const h = Math.floor(whole / 3600);
	const m = Math.floor((whole % 3600) / 60);
	const s = whole % 60;
	const ss = String(s).padStart(2, "0");
	const clock = h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
	return tenths ? `${clock}.${Math.floor((total - whole) * 10)}` : clock;
}

export const formatTime = (time: ReviewTime): string =>
	time.end === undefined
		? formatClock(time.start)
		: `${formatClock(time.start)}-${formatClock(time.end)}`;

const percent = (n: number) => `${Math.round(n * 100)}%`;

export const formatArea = (area: ReviewArea): string =>
	`${percent(area.x)},${percent(area.y)} ${percent(area.w)}x${percent(area.h)}`;

/** the anchor as the result text prints it, so the pane and the agent read the same */
export function anchorLabel(comment: Pick<ReviewComment, "area" | "time">): string | undefined {
	const parts = [
		comment.time && formatTime(comment.time),
		comment.area && `area ${formatArea(comment.area)}`,
	].filter(Boolean);
	return parts.length > 0 ? parts.join(" ") : undefined;
}

/** a frame box shows while the clip sits at its moment or inside its range */
export function timeCovers(time: ReviewTime | undefined, at: number, slack = 0.25): boolean {
	if (!time) return true;
	return at >= time.start - slack && at <= (time.end ?? time.start) + slack;
}

/** numbered in the order they were left, the pins on the stage use the same numbers */
export function pinNumbers(comments: readonly ReviewComment[]): Map<string, number> {
	const numbers = new Map<string, number>();
	for (const comment of comments) {
		if (comment.area || comment.time) numbers.set(comment.id, numbers.size + 1);
	}
	return numbers;
}
