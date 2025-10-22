import type { Message } from "$lib/types/Message";

/**
 * Escapes characters in a string that have special meaning in regular expressions.
 * @param str The string to escape.
 * @returns The escaped string.
 */
function escapeRegExp(str: string): string {
	// $& means the whole matched string
	return str.replace(/[.*+?^${}()|[\]\]/g, "\$&");
}

export function searchTokens(
	tokens: Pick<Message, "content" | "from" | "id">[],
	query: string
): Pick<Message, "content" | "from" | "id">[] {
	if (!query) {
		return tokens;
	}

	const results: Pick<Message, "content" | "from" | "id">[] = [];
	const queryTokens = query.toLowerCase().split(" ");

	for (const token of tokens) {
		if (
			queryTokens.every((queryToken) => {
				if (queryToken.startsWith("-")) {
					const regex = new RegExp(escapeRegExp(queryToken.substring(1)), "i");
					return !regex.test(token.content);
				} else {
					const regex = new RegExp(escapeRegExp(queryToken), "i");
					return regex.test(token.content);
				}
			})
		) {
			results.push(token);
		}
	}

	return results;
}
