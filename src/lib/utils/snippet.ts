const DIACRITIC_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

function normalize(s: string): string {
	return s.normalize("NFD").replace(DIACRITIC_MARKS, "").toLowerCase();
}

export interface Snippet {
	snippet: string;
	matchedText: string;
}

export function buildSnippet(text: string, query: string, maxLen = 160): Snippet {
	const trimmed = (text ?? "").replace(/\s+/g, " ").trim();
	const q = (query ?? "").trim();
	if (!trimmed || !q) {
		return { snippet: trimmed.slice(0, maxLen), matchedText: "" };
	}

	const normText = normalize(trimmed);
	const normQuery = normalize(q);
	const matchIdx = normText.indexOf(normQuery);

	if (matchIdx < 0) {
		const snippet = trimmed.length > maxLen ? trimmed.slice(0, maxLen).trimEnd() + "…" : trimmed;
		return { snippet, matchedText: "" };
	}

	const matchedText = trimmed.slice(matchIdx, matchIdx + q.length);
	// Clamp `before` so a query longer than maxLen can't push the window
	// forward into the middle of the match (which would render an
	// un-highlightable snippet client-side).
	const before = Math.max(0, Math.floor((maxLen - q.length) / 2));
	const end = Math.min(trimmed.length, Math.max(0, matchIdx - before) + maxLen);
	const start = Math.max(0, end - maxLen);

	let snippet = trimmed.slice(start, end).trim();
	if (start > 0) snippet = "…" + snippet;
	if (end < trimmed.length) snippet = snippet + "…";
	return { snippet, matchedText };
}
