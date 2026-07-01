import type { EndpointMessage } from "../../endpoints/endpoints";

// Case-insensitive so capitalized variants (<THINK>, <Think>) are stripped too.
const ROUTER_REASONING_REGEX = /<think>[\s\S]*?(?:<\/think>|$)/gi;

export function stripReasoningBlocks(text: string): string {
	const stripped = text.replace(ROUTER_REASONING_REGEX, "");
	return stripped === text ? text : stripped.trim();
}

export function stripReasoningFromMessageForRouting(message: EndpointMessage): EndpointMessage {
	const clone = { ...message } as EndpointMessage & { reasoning?: string };
	if ("reasoning" in clone) {
		delete clone.reasoning;
	}
	const content =
		typeof message.content === "string" ? stripReasoningBlocks(message.content) : message.content;
	return {
		...clone,
		content,
	};
}
