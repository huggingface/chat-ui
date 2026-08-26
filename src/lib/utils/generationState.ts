import type { Message } from "$lib/types/Message";
import {
	MessageToolUpdateType,
	MessageUpdateStatus,
	MessageUpdateType,
} from "$lib/types/MessageUpdate";

/**
 * A parked-and-resumed turn (the `wait` tool) has a lifecycle, not a single
 * ending: every park stamps a `finished` status and every server-side resume
 * stamps a new `started`. "Ever finished" would freeze the message at its
 * first park — reloads would never reattach and resumes would stay invisible
 * to an open page — so the LAST lifecycle event decides.
 */
export function isAssistantGenerationTerminal(message?: Message): boolean {
	if (!message || message.from !== "assistant") return true;

	if (message.interrupted === true) return true;

	const updates = message.updates ?? [];
	for (let i = updates.length - 1; i >= 0; i -= 1) {
		const update = updates[i];
		if (update.type === MessageUpdateType.FinalAnswer) return true;
		if (update.type === MessageUpdateType.Status) {
			if (
				update.status === MessageUpdateStatus.Error ||
				update.status === MessageUpdateStatus.Finished
			) {
				return true;
			}
			if (update.status === MessageUpdateStatus.Started) return false;
		}
	}
	return false;
}

export function isConversationGenerationActive(messages: Message[]): boolean {
	const lastAssistant = [...messages].reverse().find((message) => message.from === "assistant");
	if (!lastAssistant) return false;

	return !isAssistantGenerationTerminal(lastAssistant);
}

/**
 * Matches WAIT_TOOL_NAME in builtinTools/waitTool.ts, which cannot be imported
 * here: that module reaches the database, and this one is shared with the
 * client bundle.
 */
const WAIT_TOOL = "wait";

/**
 * Whether this message's last act was parking on the `wait` tool: a wait call
 * with no result yet. While parked the message reads terminal — that run's
 * lifecycle closed with `finished` — but the sweeper will resume it
 * server-side under a new generationId, so a parked message is a nap, not an
 * ending, and a page showing one should keep watching for the resume.
 */
export function isAssistantParkedOnWait(message?: Message): boolean {
	if (!message || message.from !== "assistant" || message.interrupted === true) return false;

	const pending = new Set<string>();
	for (const update of message.updates ?? []) {
		if (update.type !== MessageUpdateType.Tool) continue;
		if (update.subtype === MessageToolUpdateType.Call && update.call.name === WAIT_TOOL) {
			pending.add(update.uuid);
		} else if (
			update.subtype === MessageToolUpdateType.Result ||
			update.subtype === MessageToolUpdateType.Error
		) {
			pending.delete(update.uuid);
		}
	}
	return pending.size > 0;
}
