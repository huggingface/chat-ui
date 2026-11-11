/**
 * Citations the model writes: `[p. 5](paper:1706.03762#p5 "exact words from the page")`.
 * The link title carries the passage so the model never has to URL-encode it.
 *
 * Kept apart from `paper.ts` because the markdown worker imports it, and that
 * bundle should not pull in the message-update helpers.
 */
const PAPER_HREF = /^paper:([A-Za-z0-9][\w.\-/]{0,79})#p(\d{1,5})$/;

export function parsePaperHref(href: string): { paperId: string; page: number } | null {
	const m = PAPER_HREF.exec(href.trim());
	if (!m || m[1].includes("..")) return null;
	const page = Number(m[2]);
	return page >= 1 ? { paperId: m[1], page } : null;
}

export function paperHref(paperId: string, page: number): string {
	return `paper:${paperId}#p${page}`;
}
