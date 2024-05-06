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

type BaseMarkdownElement = {
	type: MarkdownElementType;
	content: string;
	parent: HeaderElement | null;
};

export type HeaderElement = BaseMarkdownElement & {
	type: MarkdownElementType.Header;
	level: number;
	children: MarkdownElement[];
};
type ParagraphElement = BaseMarkdownElement & { type: MarkdownElementType.Paragraph };
type CodeBlockElement = BaseMarkdownElement & { type: MarkdownElementType.CodeBlock };
type ListItemElement = BaseMarkdownElement & {
	type: MarkdownElementType.UnorderedListItem | MarkdownElementType.OrderedListItem;
	depth: number;
};
type BlockQuoteElement = BaseMarkdownElement & {
	type: MarkdownElementType.BlockQuote;
	depth: number;
};

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
