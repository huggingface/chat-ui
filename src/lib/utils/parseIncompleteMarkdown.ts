/*
 * Completes or strips incomplete markdown tokens while streaming so partial syntax
 * (unclosed **bold**, [links](...), $$math$$, half-typed trailing HTML tags, ...)
 * doesn't flash as raw text. Backed by remend, the engine behind Vercel's streamdown:
 * https://github.com/vercel/streamdown/tree/main/packages/remend
 *
 * Incomplete links are closed with the placeholder URL `streamdown:incomplete-link`,
 * which the link renderer in ./marked.ts turns into a non-clickable anchor.
 */
import remend from "remend";

// remend's defaults apply: all completion handlers on, `inlineKatex` off because a
// lone `$` is more often a currency symbol than the start of inline math.
export function parseIncompleteMarkdown(text: string): string {
	return remend(text);
}
