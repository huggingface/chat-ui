/**
 * Remove `<think>` blocks and their contents from model output.
 *
 * The unterminated case matters: when a generation budget runs out mid-trace
 * the closing tag never arrives, so an anchored `$` alternative is what stops
 * raw reasoning from leaking out as if it were the answer.
 */
export function stripThink(content: string): string {
	return content.replace(/<think>[\s\S]*?(?:<\/think>|$)/g, "").trim();
}
