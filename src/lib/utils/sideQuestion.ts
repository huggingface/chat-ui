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
 * a slack message read as a side question, btw with an optional leading slash or trailing colon
 * after any mentions, empty for a bare btw so it is never queued as a task
 */
export function slackSideQuestion(text: string): string | undefined {
	const withoutMentions = text.replace(/^(\s*<@[A-Z0-9]+(?:\|[^>]*)?>)+/i, "").trimStart();
	const match = /^\/?btw\b:?\s*([\s\S]*)$/i.exec(withoutMentions);
	return match ? match[1].trim() : undefined;
}

export function isSlackSideQuestion(text: string | undefined): boolean {
	return slackSideQuestion(text ?? "") !== undefined;
}
