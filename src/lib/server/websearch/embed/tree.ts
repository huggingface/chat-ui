import type { MarkdownElement } from "../markdown/types";

export function flattenTree(elem: MarkdownElement): MarkdownElement[] {
	if ("children" in elem) return [elem, ...elem.children.flatMap(flattenTree)];
	return [elem];
}
