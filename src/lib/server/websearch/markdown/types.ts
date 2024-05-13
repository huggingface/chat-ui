/* eslint-disable-next-line no-shadow */
export enum MarkdownElementType {
	Header = "HEADER",
	Paragraph = "PARAGRAPH",
	BlockQuote = "BLOCKQUOTE",
	CodeBlock = "CODE_BLOCK",

	UnorderedList = "UNORDERED_LIST",
	OrderedList = "ORDERED_LIST",
	UnorderedListItem = "UNORDERED_LIST_ITEM",
	OrderedListItem = "ORDERED_LIST_ITEM",
}

interface BaseMarkdownElement<T = MarkdownElementType> {
	type: T;
	content: string;
	parent: HeaderElement | null;
}

export interface HeaderElement extends BaseMarkdownElement<MarkdownElementType.Header> {
	level: number;
	children: MarkdownElement[];
}
type ListItem = MarkdownElementType.UnorderedListItem | MarkdownElementType.OrderedListItem;
interface ListItemElement extends BaseMarkdownElement<ListItem> {
	depth: number;
}
interface BlockQuoteElement extends BaseMarkdownElement<MarkdownElementType.BlockQuote> {
	depth: number;
}
interface ParagraphElement extends BaseMarkdownElement<MarkdownElementType.Paragraph> {}
interface CodeBlockElement extends BaseMarkdownElement<MarkdownElementType.CodeBlock> {}

export type MarkdownElement =
	| HeaderElement
	| ParagraphElement
	| BlockQuoteElement
	| CodeBlockElement
	| ListItemElement;

export const tagNameMap: Record<string, MarkdownElementType> = {
	h1: MarkdownElementType.Header,
	h2: MarkdownElementType.Header,
	h3: MarkdownElementType.Header,
	h4: MarkdownElementType.Header,
	h5: MarkdownElementType.Header,
	h6: MarkdownElementType.Header,
	div: MarkdownElementType.Paragraph,
	p: MarkdownElementType.Paragraph,
	blockquote: MarkdownElementType.BlockQuote,
	pre: MarkdownElementType.CodeBlock,
	ul: MarkdownElementType.UnorderedList,
	ol: MarkdownElementType.OrderedList,
	li: MarkdownElementType.UnorderedListItem,
};
