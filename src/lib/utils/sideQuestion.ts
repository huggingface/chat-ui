/** the question after /btw at index 0, undefined when the text is not one */
export function webSideQuestion(text: string): string | undefined {
	const match = /^\/btw\s+([\s\S]+)$/i.exec(text);
	return match?.[1].trim() || undefined;
}

/** true for /btw at index 0, bare or not, so a bare /btw is swallowed rather than sent */
export function isWebSideQuestion(text: string): boolean {
	return /^\/btw(\s|$)/i.test(text);
}

/**
 * a slack message to the bot read as a side question, /btw first after the bot mention or a
 * space, slack refuses a message that starts with a slash, empty when bare
 */
export function slackSideQuestion(text: string, botUserId: string): string | undefined {
	const mention = new RegExp(`^(\\s*<@${botUserId}(?:\\|[^>]*)?>)+`);
	const match = /^\/btw(?:\s+([\s\S]*))?$/i.exec(text.replace(mention, "").trimStart());
	return match ? (match[1] ?? "").trim() : undefined;
}
