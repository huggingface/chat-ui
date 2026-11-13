/**
 * Citations the model writes: `[p. 5](paper:1706.03762#p5 "exact words from the page")`.
 * The link title carries the passage so the model never has to URL-encode it.
 *
 * Kept apart from `paper.ts` because the markdown worker imports it, and that
 * bundle should not pull in the message-update helpers.
 */
const PAPER_HREF = /^paper:([A-Za-z0-9][\w.\-/:]{0,89})(?:#p(\d{1,5}))?$/i;

const ARXIV_VERSIONED = /^(\d{4}\.\d{4,5}|[a-z][a-z-]*(?:\.[A-Z]{2})?\/\d{7})v\d+$/;

/**
 * The id a paper is stored under, from the way a model or user may write it:
 * `arxiv:` dropped, and an arXiv version suffix too (open_paper stores arXiv
 * papers by their bare id, while the PDF's margin prints `1706.03762v7`).
 */
export function normalizePaperId(id: string): string {
	const bare = id.trim().replace(/^arxiv:/i, "");
	return ARXIV_VERSIONED.exec(bare)?.[1] ?? bare;
}

/** A `paper:` href as a paper and page; a link without `#pN` points at page 1. */
export function parsePaperHref(href: string): { paperId: string; page: number } | null {
	const m = PAPER_HREF.exec(href.trim());
	if (!m) return null;
	const paperId = normalizePaperId(m[1]);
	if (!paperId || paperId.includes("..") || paperId.includes(":")) return null;
	const page = m[2] === undefined ? 1 : Number(m[2]);
	return page >= 1 ? { paperId, page } : null;
}

export function paperHref(paperId: string, page: number): string {
	return `paper:${paperId}#p${page}`;
}
