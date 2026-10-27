export const SLACK_FRAMING_START = "The invoking Slack user is ";
export const SLACK_REQUEST_MARKER = "Invoking user's request:\n";

// framing only starts a message or a follow-up joined with a blank line, and names a Slack user id
const framing = new RegExp(
	`(^|\\n\\n)(${SLACK_FRAMING_START}[A-Z0-9]+\\.[\\s\\S]*?)${SLACK_REQUEST_MARKER}`,
	"g"
);

export function splitSlackRequest(content: string): { request: string; context?: string } {
	const blocks = [...content.matchAll(framing)].map((match) => match[2].trim());
	if (!blocks.length) return { request: content };
	return {
		request: content.replace(framing, "$1").trim(),
		context: blocks.join("\n\n"),
	};
}
