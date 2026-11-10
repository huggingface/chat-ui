import type { Message } from "$lib/types/Message";
import type { MessageToolUpdate } from "$lib/types/MessageUpdate";
import { ToolResultStatus } from "$lib/types/Tool";
import {
	isMessageToolCallUpdate,
	isMessageToolProgressUpdate,
	isMessageToolResultUpdate,
	isMessageToolUpdate,
} from "$lib/utils/messageUpdates";
import { spaceIdToEmbedOrigin } from "$lib/utils/trackio";

export const CHECK_SPACE_TOOL_NAME = "check_space";

/** first line of check_space output and the progress message that opens the pane, so it only opens from text chat-ui wrote */
export function spaceCheckHeader(spaceId: string, stage: string, isPrivate: boolean): string {
	return `Space ${spaceId}: ${stage}${isPrivate ? " (private)" : ""} — https://huggingface.co/spaces/${spaceId}`;
}

const HEADER =
	/^Space ([A-Za-z0-9][\w.-]*)\/([\w.-]+): ([A-Z_]+)( \(private\))? — https:\/\/huggingface\.co\/spaces\/\1\/\2$/m;

/** marks a result whose space ran the console handshake */
export const CONSOLE_SECTION_PREFIX = "Console";

export interface SpaceCheck {
	spaceId: string;
	url: string;
	label: string;
	private: boolean;
	/** the check_space update uuid, a new one reloads the frame */
	checkId: string;
	messageId?: Message["id"];
}

function parseHeader(text: string): Omit<SpaceCheck, "checkId" | "messageId"> | undefined {
	const match = text.match(HEADER);
	if (!match || match[3] !== "RUNNING") return undefined;
	const url = spaceIdToEmbedOrigin(match[1], match[2]);
	if (!url) return undefined;
	const spaceId = `${match[1]}/${match[2]}`;
	return { spaceId, url, label: spaceId, private: !!match[4] };
}

/** from the live progress update while the call runs, from the stored result afterwards */
export function spaceChecksFromToolUpdates(updates: MessageToolUpdate[]): SpaceCheck[] {
	const checkCalls = new Set(
		updates
			.filter(isMessageToolCallUpdate)
			.filter((update) => update.call.name === CHECK_SPACE_TOOL_NAME)
			.map((update) => update.uuid)
	);
	const found = new Map<string, SpaceCheck>();
	for (const update of updates) {
		if (!checkCalls.has(update.uuid) || found.has(update.uuid)) continue;
		let parsed: ReturnType<typeof parseHeader>;
		if (isMessageToolProgressUpdate(update) && update.message) {
			parsed = parseHeader(update.message);
		} else if (isMessageToolResultUpdate(update)) {
			if (update.result.status !== ToolResultStatus.Success) continue;
			const text = update.result.outputs
				.map((output) => output["text"])
				.find((value): value is string => typeof value === "string");
			if (text && new RegExp(`^${CONSOLE_SECTION_PREFIX}\\b`, "m").test(text)) {
				parsed = parseHeader(text);
			}
		}
		if (parsed) found.set(update.uuid, { ...parsed, checkId: update.uuid });
	}
	return [...found.values()];
}

/** one item per space with its latest check, oldest space first */
export function collectSpaceChecks(
	messages: Array<Pick<Message, "id" | "from" | "updates">>
): SpaceCheck[] {
	const found = new Map<string, SpaceCheck>();
	for (const message of messages) {
		if (message.from !== "assistant" || !message.updates?.length) continue;
		for (const check of spaceChecksFromToolUpdates(message.updates.filter(isMessageToolUpdate))) {
			const first = found.get(check.url);
			found.set(check.url, { ...check, messageId: first?.messageId ?? message.id });
		}
	}
	return [...found.values()];
}
