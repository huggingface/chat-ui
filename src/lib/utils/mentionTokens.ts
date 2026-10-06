/**
 * An accepted @-mention of a Hub repo, kept as one unit in the composer: its
 * `@owner/name` wrapped in this character (U+2064 INVISIBLE PLUS). The marks
 * tell the composer to draw it as a link-colored token and delete it whole,
 * and keep a repo the user picked apart from text they merely typed. A
 * separate mark from dashboard views (U+2063), so the two never mix.
 */
export const MENTION_MARK = "⁤";
const MENTION_TOKEN = /⁤(@[^⁤\s]{1,200})⁤/g;

export function mentionToken(resourceId: string): string {
	return `${MENTION_MARK}@${resourceId}${MENTION_MARK}`;
}

export interface MentionTokenSpan {
	start: number;
	end: number;
	text: string;
}

export function findMentionTokens(text: string): MentionTokenSpan[] {
	if (!text.includes(MENTION_MARK)) return [];
	return [...text.matchAll(MENTION_TOKEN)].map((m) => ({
		start: m.index ?? 0,
		end: (m.index ?? 0) + m[0].length,
		text: m[1],
	}));
}

/** Drops marks left over from a mention that was cut in half, keeping the words. */
export function stripOrphanMentionMarks(text: string): string {
	if (!text.includes(MENTION_MARK)) return text;
	let out = "";
	let last = 0;
	for (const token of findMentionTokens(text)) {
		out += text.slice(last, token.start).replaceAll(MENTION_MARK, "");
		out += text.slice(token.start, token.end);
		last = token.end;
	}
	return out + text.slice(last).replaceAll(MENTION_MARK, "");
}

/** The text with every mention's marks removed: what anyone but the composer reads. */
export function plainMentions(text: string): string {
	return text.replaceAll(MENTION_MARK, "");
}
