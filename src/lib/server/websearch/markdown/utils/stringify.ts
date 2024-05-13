import type { SerializedHTMLElement } from "../../scrape/types";
import { MarkdownElementType, type MarkdownElement } from "../types";

// --- Markdown Elements ---

/** Converts markdown element to a string with formatting */
export function stringifyMarkdownElement(elem: MarkdownElement): string {
	const content = elem.content.trim();
	if (elem.type === MarkdownElementType.Header) return `${"#".repeat(elem.level)} ${content}\n\n`;
	if (elem.type === MarkdownElementType.BlockQuote) {
		return `${"> ".repeat(elem.depth)}${content}\n\n`;
	}
	if (elem.type === MarkdownElementType.CodeBlock) return `\`\`\`\n${content}\n\`\`\`\n\n`;

	if (elem.type === MarkdownElementType.UnorderedListItem) return `- ${content}\n`;
	if (elem.type === MarkdownElementType.OrderedListItem) {
		const siblings = elem.parent?.children ?? [elem];
		const currentIndex = siblings.indexOf(elem);
		const lastAdjacentIndex = siblings
			.slice(currentIndex + 1)
			.findLastIndex((child) => child.type === MarkdownElementType.OrderedListItem);
		const order = currentIndex - lastAdjacentIndex + 1;
		return `${order}. ${content}\n`;
	}

	return `${content}\n\n`;
}

// ----- HTML Elements -----

/** Ignores all non-inline tag types and grabs their text. Converts inline tags to markdown */
export function stringifyHTMLElements(elems: (SerializedHTMLElement | string)[]): string {
	return elems.map(stringifyHTMLElement).join("").trim();
}

/** Ignores all non-inline tag types and grabs their text. Converts inline tags to markdown */
export function stringifyHTMLElement(elem: SerializedHTMLElement | string): string {
	if (typeof elem === "string") return elem;
	if (elem.tagName === "br") return "\n";

	const content = elem.content.map(stringifyHTMLElement).join("");
	if (content.length === 0) return content;

	if (elem.tagName === "strong" || elem.tagName === "b") return `**${content}**`;
	if (elem.tagName === "em" || elem.tagName === "i") return `*${content}*`;
	if (elem.tagName === "s" || elem.tagName === "strike") return `~~${content}~~`;

	if (elem.tagName === "code" || elem.tagName === "var" || elem.tagName === "tt") {
		return `\`${content}\``;
	}

	if (elem.tagName === "sup") return `<sup>${content}</sup>`;
	if (elem.tagName === "sub") return `<sub>${content}</sub>`;

	if (elem.tagName === "a" && content.trim().length > 0) {
		const href = elem.attributes.href;
		if (!href) return elem.content.map(stringifyHTMLElement).join("");
		return `[${elem.content.map(stringifyHTMLElement).join("")}](${href})`;
	}

	return elem.content.map(stringifyHTMLElement).join("");
}

/** Grabs all text content directly, ignoring HTML tags */
export function stringifyHTMLElementsUnformatted(
	elems: (SerializedHTMLElement | string)[]
): string {
	return elems.map(stringifyHTMLElementUnformatted).join("");
}

/** Grabs all text content directly, ignoring HTML tags */
function stringifyHTMLElementUnformatted(elem: SerializedHTMLElement | string): string {
	if (typeof elem === "string") return elem;
	return elem.content.map(stringifyHTMLElementUnformatted).join("");
}
