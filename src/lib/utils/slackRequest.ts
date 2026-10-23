/**
 * Slack turns store the harness framing (instructions and quoted thread) ahead of the request.
 * The model needs it; readers only need the request, with the framing available on demand.
 */
export const SLACK_FRAMING_START = "The invoking Slack user is ";
export const SLACK_REQUEST_MARKER = "Invoking user's request:\n";

// Lazy, so each block ends at its own marker; queued follow-ups join several blocks.
const framing = new RegExp(`${SLACK_FRAMING_START}[\\s\\S]*?${SLACK_REQUEST_MARKER}`, "g");

export function splitSlackRequest(content: string): { request: string; context?: string } {
	const blocks = content.match(framing);
	if (!blocks) return { request: content };
	return {
		request: content.replace(framing, "").trim(),
		context: blocks
			.map((block) => block.slice(0, -SLACK_REQUEST_MARKER.length).trim())
			.join("\n\n"),
	};
}
