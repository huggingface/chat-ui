import type { MessageToolProgressUpdate } from "$lib/types/MessageUpdate";

/** "4/30" for the header beside the tool name, "" when there is nothing to count. */
export function formatToolProgressCount(progress?: MessageToolProgressUpdate): string {
	if (!progress) return "";
	const total = typeof progress.total === "number" ? `/${progress.total}` : "";
	return `${progress.progress}${total}`;
}

/**
 * What the sub-agent is doing, without the count — one line per concurrent call,
 * so the caller renders them as lines rather than joining them.
 */
export function formatToolProgressLines(progress?: MessageToolProgressUpdate): string[] {
	const message = progress?.message?.trim();
	if (!message) return [];
	return message
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
}
