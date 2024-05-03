import type { SerializedHTMLElement } from "../scrape/types";
import { htmlElementToMarkdownElements, mergeAdjacentElements } from "./fromHtml";
import type { HeaderElement, MarkdownElement } from "./types";
import { MarkdownElementType } from "./types";
import { chunkElements } from "./utils/chunk";

/**
 * Converts HTML elements to Markdown elements and creates a tree based on header tags
 * For example: h1 [h2 [p p blockquote] h2 [h3 [...] ] ]
 **/
export function htmlToMarkdownTree(
	title: string,
	htmlElements: SerializedHTMLElement[],
	maxCharsPerElem: number
): HeaderElement {
	let parent: HeaderElement = {
		type: MarkdownElementType.Header,
		level: 1,
		parent: null,
		content: title,
		children: [],
	};

	const markdownElements = chunkElements(
		mergeAdjacentElements(
			htmlElements.flatMap((elem) => htmlElementToMarkdownElements(parent, elem))
		),
		maxCharsPerElem
	);

	for (const elem of markdownElements) {
		if (elem.type !== MarkdownElementType.Header) {
			elem.parent = parent;
			parent.children.push(elem);
			continue;
		}

		// add 1 to current level to offset for the title being level 1
		elem.level += 1;

		// Pop up header levels until reaching the same level as the current header
		// or until we reach the root
		inner: while (parent !== null && parent.parent !== null) {
			if (parent.level < elem.level) break inner;
			parent = parent.parent;
		}
		parent.children.push(elem);
		parent = elem;
	}

	// Pop up to the root
	while (parent.parent !== null) {
		parent = parent.parent;
	}
	return parent;
}

export function removeParents<T extends MarkdownElement>(elem: T): T {
	if ("children" in elem) {
		return { ...elem, parent: null, children: elem.children.map((child) => removeParents(child)) };
	}
	return { ...elem, parent: null };
}
