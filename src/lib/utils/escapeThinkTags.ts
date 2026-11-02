/**
 * Reasoning that arrives on its own channel (`reasoning_content` and friends) is
 * wrapped in `<think>…</think>` for the UI, so a literal tag the model writes
 * inside it (e.g. while reasoning about Qwen's `<think></think>` soft switch)
 * would close the block early and spill the rest of the trace into the answer.
 * A zero-width space after the `<` keeps it reading the same while no think
 * parser matches it; the escape is undone before reasoning is echoed back to a
 * provider, which may require the trace byte for byte.
 */
const ZWSP = "\u200B";
const TAG_REGEX = /<(\/?think>)/gi;
const ESCAPED_TAG_REGEX = /<\u200B(\/?think>)/gi;
const TAGS = ["<think>", "</think>"];

export function escapeThinkTags(text: string): string {
	return text.replace(TAG_REGEX, `<${ZWSP}$1`);
}

export function unescapeThinkTags(text: string): string {
	return text.replace(ESCAPED_TAG_REGEX, "<$1");
}

/** length of the longest suffix of `text` that could still grow into a tag */
function partialTagLength(text: string): number {
	const start = text.lastIndexOf("<");
	if (start === -1) return 0;
	const tail = text.slice(start).toLowerCase();
	return TAGS.some((tag) => tag.length > tail.length && tag.startsWith(tail)) ? tail.length : 0;
}

/**
 * Streaming variant: a tag can be split across deltas, so a trailing partial
 * tag is held until the next push or flush decides it.
 */
export function createThinkTagEscaper() {
	let held = "";
	return {
		push(chunk: string): string {
			const text = held + chunk;
			const keep = partialTagLength(text);
			held = text.slice(text.length - keep);
			return escapeThinkTags(text.slice(0, text.length - keep));
		},
		flush(): string {
			const text = held;
			held = "";
			return text;
		},
	};
}
