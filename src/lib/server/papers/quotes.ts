import type { ObjectId } from "mongodb";
import {
	findPassage,
	MAX_QUOTES_PER_MESSAGE,
	parsePaperQuote,
	type PaperQuote,
} from "$lib/utils/paper";
import { findStoredPaper, loadPaperPages } from "./store";

/**
 * Quotes a user attached from the reader, as the server will store them.
 *
 * Every field the client sent is re-parsed, and anything not about a paper
 * open in this conversation is dropped. The title is the stored one, not the
 * client's, and `verified` says whether the text really is on that page of the
 * stored PDF — the model gets a client-reported passage either way, but it
 * knows which ones chat-ui could confirm.
 */
export async function acceptPaperQuotes(
	raw: unknown[] | undefined,
	conversationId: ObjectId
): Promise<PaperQuote[]> {
	if (!raw?.length) return [];
	const accepted: PaperQuote[] = [];
	const papers = new Map<string, Awaited<ReturnType<typeof findStoredPaper>>>();
	for (const item of raw.slice(0, MAX_QUOTES_PER_MESSAGE)) {
		const quote = parsePaperQuote(item);
		if (!quote) continue;
		if (!papers.has(quote.paperId)) {
			papers.set(quote.paperId, await findStoredPaper(conversationId, quote.paperId));
		}
		const paper = papers.get(quote.paperId);
		if (!paper || quote.page > paper.pages) continue;
		const pages = await loadPaperPages(conversationId, paper.sha);
		const found = pages ? findPassage(pages[quote.page - 1] ?? "", quote.text) : null;
		accepted.push({
			paperId: quote.paperId,
			page: quote.page,
			text: quote.text,
			title: paper.title,
			verified: found?.exact === true,
			...(quote.key ? { key: quote.key } : {}),
		});
	}
	return accepted;
}
