/**
 * Accepted @-mentions are wrapped in U+2064, so the composer can draw them as
 * links and delete them whole. Not U+2063, which marks dashboard views.
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

export function plainMentions(text: string): string {
	return text.replaceAll(MENTION_MARK, "");
}
