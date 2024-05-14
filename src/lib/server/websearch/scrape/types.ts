export interface SerializedHTMLElement {
	tagName: string;
	attributes: Record<string, string>;
	content: (SerializedHTMLElement | string)[];
}
