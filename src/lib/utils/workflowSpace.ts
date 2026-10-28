import type { Message } from "$lib/types/Message";
import { ToolResultStatus } from "$lib/types/Tool";
import { isMessageToolResultUpdate } from "$lib/utils/messageUpdates";
import { spaceIdToEmbedOrigin, type TrackioDashboard } from "$lib/utils/trackio";

const SPACE_PAGE_REGEX = /https:\/\/huggingface\.co\/spaces\/([A-Za-z0-9][\w.-]*)\/([\w-]+)/;

/**
 * Every gr.Workflow Space `create_workflow` wrote in the visible conversation,
 * oldest first, framed in the Trackio pane. Read from the tool's own output,
 * which chat-ui writes, never from the model's prose.
 */
export function collectWorkflowSpaces(
	messages: Array<Pick<Message, "id" | "from" | "updates">>
): TrackioDashboard[] {
	const found = new Map<string, TrackioDashboard>();
	for (const message of messages) {
		if (message.from !== "assistant") continue;
		for (const update of message.updates ?? []) {
			if (!isMessageToolResultUpdate(update)) continue;
			const { result } = update;
			if (result.status !== ToolResultStatus.Success) continue;
			if (result.call.name !== "create_workflow") continue;
			for (const output of result.outputs) {
				const text = output["text"];
				const match = typeof text === "string" ? text.match(SPACE_PAGE_REGEX) : null;
				if (!match) continue;
				const origin = spaceIdToEmbedOrigin(match[1], match[2]);
				if (!origin) continue;
				const url = `${origin}/?ui=canvas`;
				if (found.has(url)) continue;
				const spaceId = `${match[1]}/${match[2]}`;
				found.set(url, { url, label: spaceId, spaceId, messageId: message.id, kind: "workflow" });
			}
		}
	}
	return [...found.values()];
}
