export type SerializedHTMLElement = {
	tagName: string;
	attributes: Record<string, string>;
	content: (SerializedHTMLElement | string)[];
};
