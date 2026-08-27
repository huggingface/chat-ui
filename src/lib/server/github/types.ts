/**
 * What a GitHub grounding tool hands back.
 *
 * Every failure — no token, a 404, a bad line range, a network error — arrives
 * here as text with `isError` set, never as a thrown exception. A model recovers
 * from `"File not found: examples/scripts/sft.py in huggingface/trl"`; it cannot
 * do anything with a rejected promise.
 *
 * The text is Markdown because that is the channel: a tool result reaches the
 * model as one string, so the formatting has to carry the structure.
 */
export interface GithubToolResult {
	text: string;
	isError: boolean;
}
