export function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

export function highlightMatch(text: string, needle: string | undefined): string {
	const escaped = escapeHtml(text);
	if (!needle) return escaped;
	const escapedNeedle = escapeHtml(needle).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return escaped.replace(new RegExp(escapedNeedle, "gi"), (m) => `<strong>${m}</strong>`);
}
