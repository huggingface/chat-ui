export type Message = {
	from: string; // 'user' | 'assistant' | 'system' etc.
	content?: string | null;
};

function stripMarkdownAndCitations(s: string): string {
	// Remove fenced code blocks
	let out = s.replace(/```[\s\S]*?```/g, "");
	// Remove inline code
	out = out.replace(/`[^`]*`/g, "");
	// Remove citation-like [1], [12]
	out = out.replace(/\[\d+\]/g, "");
	// Collapse whitespace
	out = out.replace(/[\r\n\t]+/g, " ");
	out = out.replace(/\s+/g, " ").trim();
	return out;
}

/**
 * Build a web-search query from a list of conversation messages.
 * Strategy:
 * - prefer the most recent non-empty user message
 * - if none, fallback to the most recent non-empty assistant or system message
 * - sanitize by removing code fences, inline code and simple citation markers
 */
export function buildWebSearchQuery(messages: Message[] = []): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m?.from === "user" && m.content && m.content.trim().length) {
			return stripMarkdownAndCitations(m.content);
		}
	}

	// fallback: any non-empty message from the end
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m?.content && m.content.trim().length) {
			return stripMarkdownAndCitations(m.content);
		}
	}

	return "";
}

export default buildWebSearchQuery;
