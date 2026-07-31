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

/**
 * Cumulative cap on the expanded replay payload across the whole history.
 * Turns are budgeted newest-first; older turns that don't fit fall back to
 * the flat {role, content} shape the request used before replay existed, so a
 * long tool-heavy conversation can't outgrow a context window it used to fit.
 */
const REPLAY_HISTORY_BUDGET_CHARS = 100_000;

/**
 * Normalize a persisted update uuid into a provider-safe tool_call_id.
 * Mistral-family chat templates require exactly nine alphanumeric characters,
 * a shape every other provider also accepts; the persisted uuid is only a
 * correlation key, so the id just has to pair calls with results consistently.
 */
function toToolCallId(uuid: string, used: Set<string>): string {
	const alnum = uuid.replace(/[^a-zA-Z0-9]/g, "") || "toolcall0";
	let candidate = (alnum + "0".repeat(9)).slice(0, 9);
	for (let salt = 1; used.has(candidate); salt += 1) {
		const suffix = String(salt);
		candidate = (alnum + "0".repeat(9)).slice(0, 9 - suffix.length) + suffix;
	}
	used.add(candidate);
	return candidate;
}

const isToolCallUpdate = (u: MessageUpdate): u is MessageToolCallUpdate =>
	u.type === MessageUpdateType.Tool && u.subtype === MessageToolUpdateType.Call;
const isToolResultUpdate = (u: MessageUpdate): u is MessageToolResultUpdate =>
	u.type === MessageUpdateType.Tool && u.subtype === MessageToolUpdateType.Result;
const isToolErrorUpdate = (u: MessageUpdate): u is MessageToolErrorUpdate =>
	u.type === MessageUpdateType.Tool && u.subtype === MessageToolUpdateType.Error;

/**
 * Split `<think>` blocks out of assistant text, merging them with the
 * separately persisted `message.reasoning` when present. Parts are returned
 * individually so replay can pair round reasoning back to its tool round.
 */
function splitReasoning(
	content: string,
	storedReasoning?: string
): { visible: string; parts: string[] } {
	const thinkParts: string[] = [];
	const visible = content.replace(/<think>([\s\S]*?)(?:<\/think>|$)/g, (_match, inner: string) => {
		thinkParts.push(inner);
		return "";
	});
	const parts = [storedReasoning ?? "", ...thinkParts].map((part) => part.trim()).filter(Boolean);
	return { visible: visible.trim(), parts };
}

/**
 * Rebuild a past assistant turn from its persisted tool updates so follow-up
 * requests see the tool calls and their outputs instead of a flat text
 * summary. Rounds are inferred from update order — a Call update arriving
 * after any Result/Error starts a new round, matching how the live loop emits
 * one batch of calls per completion round. Each call's `tool_call_id` is
 * derived from the persisted update uuid via toToolCallId (the original
 * model-issued id is not persisted).
 */
function replayAssistantTurn(
	message: EndpointMessage,
	includeReasoning: boolean
): AssistantReplayMessage[] {
	const updates = message.updates ?? [];
	const { visible, parts } = splitReasoning(message.content, message.reasoning);
	// `parts` holds every recovered reasoning block across the whole turn:
	// when tools ran, the FinalAnswer handler merges the pre-tool stream into
	// content, so earlier rounds' think blocks survive there too. Rounds whose
	// Call update persisted its own `reasoning` (written by the live loop since
	// this field existed) reclaim their block below; whatever remains belongs
	// to the final answer.
	const remainingParts = [...parts];
	const buildFinalMessage = (): AssistantReplayMessage => {
		const reasoning = remainingParts.join("\n");
		return {
			role: "assistant",
			content: visible,
			...(includeReasoning && reasoning.length > 0 ? { reasoning_content: reasoning } : {}),
		};
	};

	const callUpdates = updates.filter(isToolCallUpdate);
	if (callUpdates.length === 0) {
		return [buildFinalMessage()];
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

	const usedIds = new Set<string>();
	const idByUuid = new Map(callUpdates.map((u) => [u.uuid, toToolCallId(u.uuid, usedIds)]));

	const replayed: AssistantReplayMessage[] = [];
	for (const callsInRound of rounds) {
		// Reasoning persisted on the round's Call update goes back on this
		// round's message and is deduped out of the final answer's blocks.
		const roundReasoning = includeReasoning
			? (callsInRound.map((u) => u.reasoning?.trim()).find(Boolean) ?? "")
			: "";
		if (roundReasoning) {
			const exact = remainingParts.indexOf(roundReasoning);
			if (exact !== -1) {
				remainingParts.splice(exact, 1);
			} else {
				for (let i = remainingParts.length - 1; i >= 0; i -= 1) {
					if (roundReasoning.includes(remainingParts[i])) {
						remainingParts.splice(i, 1);
					}
				}
			}
		}
		// No `content` key on tool-call messages: some OpenAI-compatible
		// backends reject empty text next to tool_calls with a 400, and the
		// per-round visible text is not persisted anyway.
		// Arguments are best-effort: updates persist only top-level primitive
		// params (nested values and file payloads are deliberately kept out of
		// storage), so the replay may be a subset of what the tool ran with.
		replayed.push({
			role: "assistant",
			tool_calls: callsInRound.map((u) => ({
				id: idByUuid.get(u.uuid) ?? u.uuid,
				type: "function" as const,
				function: { name: u.call.name, arguments: JSON.stringify(u.call.parameters ?? {}) },
			})),
			...(roundReasoning ? { reasoning_content: roundReasoning } : {}),
		});
		for (const u of callsInRound) {
			// A call with no persisted outcome means the run was aborted
			// mid-execution; say so instead of fabricating an empty success.
			const output = outputsByUuid.has(u.uuid)
				? (outputsByUuid.get(u.uuid) ?? "")
				: "Error: interrupted before a result was recorded";
			replayed.push({
				role: "tool",
				tool_call_id: idByUuid.get(u.uuid) ?? u.uuid,
				content:
					output.length > MAX_REPLAYED_TOOL_OUTPUT_CHARS
						? output.slice(0, MAX_REPLAYED_TOOL_OUTPUT_CHARS) + "\n[...truncated]"
						: output,
			});
		}
	}
	replayed.push(buildFinalMessage());
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
 * - With `attachReasoning`, only the reasoning half: assistant turns stay
 *   flat but carry `reasoning_content`, for tool-less requests where replayed
 *   tool messages would be undefined behavior (no `tools` in the request).
 *   Callers gate it on the model's reasoning capability; with
 *   `replayToolHistory` it defaults to on unless explicitly disabled.
 */
export async function prepareMessagesWithFiles(
	messages: EndpointMessage[],
	imageProcessor: ReturnType<typeof makeImageProcessor>,
	isMultimodal: boolean,
	options?: { replayToolHistory?: boolean; attachReasoning?: boolean }
): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[]> {
	type ReplayCandidate = { replay: AssistantReplayMessage[]; flat: ChatMessageParam };
	const prepared = await Promise.all(
		messages.map(async (message): Promise<ChatMessageParam[] | ReplayCandidate> => {
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
			if (message.from === "assistant") {
				const flat: ChatMessageParam = { role: "assistant", content: message.content };
				if (options?.replayToolHistory) {
					return {
						replay: replayAssistantTurn(message, options?.attachReasoning ?? true),
						flat,
					};
				}
				if (options?.attachReasoning) {
					const { visible, parts } = splitReasoning(message.content, message.reasoning);
					const reasoning = parts.join("\n");
					if (reasoning.length === 0) {
						return [flat];
					}
					// Candidate, not a plain array, so the reasoning payload goes
					// through the same newest-first budget as tool replay.
					return {
						replay: [{ role: "assistant", content: visible, reasoning_content: reasoning }],
						flat,
					};
				}
			}
			return [{ role: message.from, content: message.content }];
		})
	);

	// Spend the replay budget newest-first so recent turns keep their full
	// tool history and older ones degrade to the pre-replay flat shape. The
	// degradation is monotonic: once any turn falls back to flat, every older
	// turn does too, so the model never sees rich history for a stale turn
	// while the turn it is continuing from is plain prose.
	let budget = REPLAY_HISTORY_BUDGET_CHARS;
	let exhausted = false;
	const resolved: ChatMessageParam[][] = new Array(prepared.length);
	for (let i = prepared.length - 1; i >= 0; i -= 1) {
		const entry = prepared[i];
		if (Array.isArray(entry)) {
			resolved[i] = entry;
			continue;
		}
		const cost = JSON.stringify(entry.replay).length;
		if (!exhausted && cost <= budget) {
			budget -= cost;
			resolved[i] = entry.replay;
		} else {
			exhausted = true;
			resolved[i] = [entry.flat];
		}
	}
	return resolved.flat();
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
