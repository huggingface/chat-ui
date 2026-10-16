/** the question after a leading /btw, undefined when the text is not one */
export function webSideQuestion(text: string): string | undefined {
	const match = /^\/btw\s+([\s\S]+)$/i.exec(text.trimStart());
	return match?.[1].trim() || undefined;
}

/** true for /btw with or without a question, so a bare /btw is swallowed rather than sent */
export function isWebSideQuestion(text: string): boolean {
	return /^\/btw(\s|$)/i.test(text.trimStart());
}

/**
 * a slack message to the bot read as a side question, btw with an optional leading slash or
 * trailing colon after the bot mention, empty for a bare btw
 */
export function slackSideQuestion(text: string, botUserId: string): string | undefined {
	const mention = new RegExp(`^(\\s*<@${botUserId}(?:\\|[^>]*)?>)+`);
	const match = /^\/?btw\b:?\s*([\s\S]*)$/i.exec(text.replace(mention, "").trimStart());
	return match ? match[1].trim() : undefined;
}
