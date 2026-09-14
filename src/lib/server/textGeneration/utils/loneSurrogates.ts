/**
 * Slicing a JS string at a fixed index can split a UTF-16 surrogate pair,
 * leaving a lone surrogate. `JSON.stringify` escapes it as a bare `\uD8xx`,
 * which strict JSON parsers upstream reject — the HF router 400s the whole
 * request over one character ("unexpected end of hex escape"). Run every
 * truncated string through this before it goes into a message.
 */
const LONE_SURROGATES = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function stripLoneSurrogates(text: string): string {
	return text.replace(LONE_SURROGATES, "");
}
