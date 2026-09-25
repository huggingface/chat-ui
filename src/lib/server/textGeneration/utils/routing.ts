import type { EndpointMessage } from "../../endpoints/endpoints";
import { toLegacyShape } from "$lib/utils/messageShape";

const ROUTER_REASONING_REGEX = /<think>[\s\S]*?(?:<\/think>|$)/g;

export function stripReasoningBlocks(text: string): string {
	const stripped = text.replace(ROUTER_REASONING_REGEX, "");
	return stripped === text ? text : stripped.trim();
}

export function stripReasoningFromMessageForRouting(message: EndpointMessage): EndpointMessage {
	const clone = { ...toLegacyShape(message) } as EndpointMessage & { reasoning?: string };
	if ("reasoning" in clone) {
		delete clone.reasoning;
	}
	const content =
		typeof clone.content === "string" ? stripReasoningBlocks(clone.content) : clone.content;
	return {
		...clone,
		content,
	};
}
