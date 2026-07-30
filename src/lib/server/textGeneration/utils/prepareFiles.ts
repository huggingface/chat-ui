import type { MessageFile } from "$lib/types/Message";
import type { EndpointMessage } from "$lib/server/endpoints/endpoints";
import type { OpenAI } from "openai";
import { TEXT_MIME_ALLOWLIST } from "$lib/constants/mime";
import type { makeImageProcessor } from "$lib/server/endpoints/images";
import {
	MessageToolUpdateType,
	MessageUpdateType,
	type MessageToolCallUpdate,
	type MessageToolErrorUpdate,
	type MessageToolResultUpdate,
	type MessageUpdate,
} from "$lib/types/MessageUpdate";
import { ToolResultStatus } from "$lib/types/Tool";

type ChatMessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;

/**
 * Assistant message extended with the reasoning echo field consumed by
 * preserved-thinking backends (e.g. Kimi K2/K3). Providers that don't know the
 * field ignore it.
 */
type AssistantReplayMessage = ChatMessageParam & { reasoning_content?: string };

/** Cap replayed tool outputs so old turns can't flood the context window. */
const MAX_REPLAYED_TOOL_OUTPUT_CHARS = 8000;

const isToolCallUpdate = (u: MessageUpdate): u is MessageToolCallUpdate =>
	u.type === MessageUpdateType.Tool && u.subtype === MessageToolUpdateType.Call;
const isToolResultUpdate = (u: MessageUpdate): u is MessageToolResultUpdate =>
	u.type === MessageUpdateType.Tool && u.subtype === MessageToolUpdateType.Result;
const isToolErrorUpdate = (u: MessageUpdate): u is MessageToolErrorUpdate =>
	u.type === MessageUpdateType.Tool && u.subtype === MessageToolUpdateType.Error;

/**
 * Split `<think>` blocks out of assistant text, merging them with the
 * separately persisted `message.reasoning` when present.
 */
function splitReasoning(
	content: string,
	storedReasoning?: string
): { visible: string; reasoning: string } {
	const thinkParts: string[] = [];
	const visible = content.replace(/<think>([\s\S]*?)(?:<\/think>|$)/g, (_match, inner: string) => {
		thinkParts.push(inner);
		return "";
	});
	const reasoning = [storedReasoning ?? "", ...thinkParts]
		.map((part) => part.trim())
		.filter(Boolean)
		.join("\n");
	return { visible: visible.trim(), reasoning };
}

/**
 * Rebuild a past assistant turn from its persisted tool updates so follow-up
 * requests see the tool calls and their outputs instead of a flat text
 * summary. Rounds are inferred from update order — a Call update arriving
 * after any Result/Error starts a new round, matching how the live loop emits
 * one batch of calls per completion round. The update `uuid` doubles as the
 * OpenAI `tool_call_id` (the original model-issued id is not persisted; the id
 * only needs to pair calls with results consistently).
 */
function replayAssistantTurn(message: EndpointMessage): AssistantReplayMessage[] {
	const updates = message.updates ?? [];
	const { visible, reasoning } = splitReasoning(message.content, message.reasoning);
	const finalMessage: AssistantReplayMessage = {
		role: "assistant",
		content: visible,
		...(reasoning.length > 0 ? { reasoning_content: reasoning } : {}),
	};

	const callUpdates = updates.filter(isToolCallUpdate);
	if (callUpdates.length === 0) {
		return [finalMessage];
	}

	const outputsByUuid = new Map<string, string>();
	const rounds: MessageToolCallUpdate[][] = [];
	let round: MessageToolCallUpdate[] = [];
	let roundHasOutcome = false;
	for (const update of updates) {
		if (isToolCallUpdate(update)) {
			if (roundHasOutcome && round.length > 0) {
				rounds.push(round);
				round = [];
				roundHasOutcome = false;
			}
			round.push(update);
		} else if (isToolResultUpdate(update)) {
			const result = update.result;
			const firstOutput =
				result.status === ToolResultStatus.Success ? result.outputs[0] : undefined;
			outputsByUuid.set(
				update.uuid,
				result.status === ToolResultStatus.Success
					? typeof firstOutput?.text === "string"
						? firstOutput.text
						: JSON.stringify(firstOutput ?? "")
					: `Error: ${result.message}`
			);
			roundHasOutcome = true;
		} else if (isToolErrorUpdate(update)) {
			outputsByUuid.set(update.uuid, `Error: ${update.message}`);
			roundHasOutcome = true;
		}
	}
	if (round.length > 0) {
		rounds.push(round);
	}

	const replayed: AssistantReplayMessage[] = [];
	for (const callsInRound of rounds) {
		// No `content` key on tool-call messages: some OpenAI-compatible
		// backends reject empty text next to tool_calls with a 400, and the
		// per-round visible text is not persisted anyway.
		replayed.push({
			role: "assistant",
			tool_calls: callsInRound.map((u) => ({
				id: u.uuid,
				type: "function" as const,
				function: { name: u.call.name, arguments: JSON.stringify(u.call.parameters ?? {}) },
			})),
		});
		for (const u of callsInRound) {
			const output = outputsByUuid.get(u.uuid) ?? "";
			replayed.push({
				role: "tool",
				tool_call_id: u.uuid,
				content:
					output.length > MAX_REPLAYED_TOOL_OUTPUT_CHARS
						? output.slice(0, MAX_REPLAYED_TOOL_OUTPUT_CHARS) + "\n[...truncated]"
						: output,
			});
		}
	}
	replayed.push(finalMessage);
	return replayed;
}

/**
 * Prepare chat messages for OpenAI-compatible multimodal payloads.
 * - Processes images via the provided imageProcessor (resize/convert) when multimodal is enabled.
 * - Injects text-file content into the user message text.
 * - Leaves messages untouched when no files or multimodal disabled.
 * - With `replayToolHistory`, expands past assistant turns into their
 *   assistant/tool message pairs (from persisted updates) and re-attaches
 *   reasoning as `reasoning_content` instead of inline `<think>` text.
 */
export async function prepareMessagesWithFiles(
	messages: EndpointMessage[],
	imageProcessor: ReturnType<typeof makeImageProcessor>,
	isMultimodal: boolean,
	options?: { replayToolHistory?: boolean }
): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[]> {
	const prepared = await Promise.all(
		messages.map(async (message): Promise<ChatMessageParam[]> => {
			if (message.from === "user" && message.files && message.files.length > 0) {
				const { imageParts, textContent } = await prepareFiles(
					imageProcessor,
					message.files,
					isMultimodal
				);

				let messageText = message.content;
				if (textContent.length > 0) {
					messageText = textContent + "\n\n" + message.content;
				}

				if (imageParts.length > 0 && isMultimodal) {
					const parts = [{ type: "text" as const, text: messageText }, ...imageParts];
					return [{ role: message.from, content: parts }];
				}

				return [{ role: message.from, content: messageText }];
			}
			if (options?.replayToolHistory && message.from === "assistant") {
				return replayAssistantTurn(message);
			}
			return [{ role: message.from, content: message.content }];
		})
	);
	return prepared.flat();
}

async function prepareFiles(
	imageProcessor: ReturnType<typeof makeImageProcessor>,
	files: MessageFile[],
	isMultimodal: boolean
): Promise<{
	imageParts: OpenAI.Chat.Completions.ChatCompletionContentPartImage[];
	textContent: string;
}> {
	const imageFiles = files.filter((file) => file.mime.startsWith("image/"));
	const textFiles = files.filter((file) => {
		const mime = (file.mime || "").toLowerCase();
		const [fileType, fileSubtype] = mime.split("/");
		return TEXT_MIME_ALLOWLIST.some((allowed) => {
			const [type, subtype] = allowed.toLowerCase().split("/");
			const typeOk = type === "*" || type === fileType;
			const subOk = subtype === "*" || subtype === fileSubtype;
			return typeOk && subOk;
		});
	});

	let imageParts: OpenAI.Chat.Completions.ChatCompletionContentPartImage[] = [];
	if (isMultimodal && imageFiles.length > 0) {
		const processedFiles = await Promise.all(imageFiles.map(imageProcessor));
		imageParts = processedFiles.map((file) => ({
			type: "image_url" as const,
			image_url: {
				url: `data:${file.mime};base64,${file.image.toString("base64")}`,
				detail: "auto",
			},
		}));
	}

	let textContent = "";
	if (textFiles.length > 0) {
		const textParts = await Promise.all(
			textFiles.map(async (file) => {
				const content = Buffer.from(file.value, "base64").toString("utf-8");
				return `<document name="${file.name}" type="${file.mime}">\n${content}\n</document>`;
			})
		);
		textContent = textParts.join("\n\n");
	}

	return { imageParts, textContent };
}
