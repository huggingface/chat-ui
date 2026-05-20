export function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

export function highlightMatch(text: string, needle: string | undefined): string {
	if (!needle) return escapeHtml(text);
	// Match on the *original* string and escape match / non-match segments
	// independently. Escaping the haystack first would let a short needle
	// (e.g. "amp") match the letters HTML entities inject ("&amp;"), which
	// shatters the entity when we insert <strong>.
	const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
	let out = "";
	let last = 0;
	for (const m of text.matchAll(re)) {
		out += escapeHtml(text.slice(last, m.index)) + `<strong>${escapeHtml(m[0])}</strong>`;
		last = m.index + m[0].length;
	}
	return out + escapeHtml(text.slice(last));
}
