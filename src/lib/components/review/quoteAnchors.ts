import { untrack } from "svelte";
import type { Action } from "svelte/action";
import type { ReviewQuote } from "$lib/types/MlReview";
import { findQuote } from "$lib/utils/review/view";

/** styled in the main stylesheet, every quotable field adds its ranges to the one registry entry */
export const QUOTE_HIGHLIGHT = "review-quote";

export interface AnchoredQuote {
	id: string;
	quote: ReviewQuote;
}

/** offsets count text the way textContent does */
function rangeAt(root: Node, start: number, end: number): Range | undefined {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	let offset = 0;
	let range: Range | undefined;
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const length = node.textContent?.length ?? 0;
		if (!range && start < offset + length) {
			range = document.createRange();
			range.setStart(node, start - offset);
		}
		if (range && end <= offset + length) {
			range.setEnd(node, end - offset);
			return range;
		}
		offset += length;
	}
	return undefined;
}

export function offsetsWithin(
	root: Node,
	range: Range
): { start: number; end: number } | undefined {
	if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return undefined;
	const before = document.createRange();
	before.selectNodeContents(root);
	before.setEnd(range.startContainer, range.startOffset);
	const start = before.toString().length;
	const length = range.toString().length;
	return length > 0 ? { start, end: start + length } : undefined;
}

/** resolved again on every change since a markdown field renders after mount, reports the quotes it lost */
export const quoteAnchors: Action<
	HTMLElement,
	{ quotes: AnchoredQuote[]; onanchors: (lost: string[]) => void }
> = (element, initial) => {
	let params = initial;
	const registry = typeof CSS !== "undefined" && "highlights" in CSS ? CSS.highlights : undefined;
	let ranges: Range[] = [];

	const clear = () => {
		const highlight = registry?.get(QUOTE_HIGHLIGHT);
		for (const range of ranges) highlight?.delete(range);
		ranges = [];
	};

	const resolve = () => {
		clear();
		const text = element.textContent ?? "";
		const lost: string[] = [];
		for (const { id, quote } of params.quotes) {
			const at = findQuote(text, quote);
			const range = at && rangeAt(element, at.start, at.end);
			if (range) ranges.push(range);
			else lost.push(id);
		}
		if (registry && ranges.length > 0) {
			let highlight = registry.get(QUOTE_HIGHLIGHT);
			if (!highlight) {
				highlight = new Highlight();
				registry.set(QUOTE_HIGHLIGHT, highlight);
			}
			for (const range of ranges) highlight.add(range);
		}
		untrack(() => params.onanchors(lost));
	};

	resolve();
	const observer = new MutationObserver(resolve);
	observer.observe(element, { childList: true, subtree: true, characterData: true });
	return {
		update(next) {
			params = next;
			resolve();
		},
		destroy() {
			observer.disconnect();
			clear();
		},
	};
};

let pendingComment: (() => void) | undefined;

/** the field holding a live selection, so the C key comments on it rather than the record */
export function offerSelectionComment(comment: (() => void) | undefined): void {
	pendingComment = comment;
}

export function takeSelectionComment(): (() => void) | undefined {
	const comment = pendingComment;
	pendingComment = undefined;
	return comment;
}
