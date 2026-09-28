import type { EndpointMessage } from "$lib/server/endpoints/endpoints";
import type { OpenAI } from "openai";
import { stripThink } from "$lib/utils/stripThink";
import { stripLoneSurrogates } from "./loneSurrogates";
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
import type { StoredHistoryWindow } from "$lib/types/Conversation";
import type { ObjectId } from "mongodb";
import { isValidJsonObject } from "$lib/server/textGeneration/mcp/toolInvocation";
import { ROUNDS_SHAPE, rebuildLegacyContent, toolRounds } from "$lib/utils/messageShape";
import { withHarnessEvent } from "./harnessEvent";
import {
	answeredQuestion,
	CHARS_PER_TOKEN,
	createHistoryWindow,
	DEFAULT_OUTPUT_TOKENS,
	groupRounds,
	historyCost,
	planWindow,
	renderWindow,
	windowLimitChars,
	type HistoryUnit,
} from "./historyWindow";
import { prepareAttachments, type AttachmentMode, type AttachmentReport } from "./attachmentBudget";

type ChatMessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;

/**
 * Assistant message extended with the reasoning echo field consumed by
 * preserved-thinking backends (e.g. Kimi K2/K3). Providers that don't know the
 * field ignore it.
 */
type AssistantReplayMessage = ChatMessageParam & { reasoning_content?: string };

/** cap on each replayed tool output, legacy path only */
const MAX_REPLAYED_TOOL_OUTPUT_CHARS = 8000;

/**
 * soft ceiling on the whole history when HISTORY_SLIDING_WINDOW is false or the model reports
 * no window, turns are replayed newest first and the rest fall back to flat text, nothing is dropped
 */
const LEGACY_HISTORY_BUDGET_CHARS = 400_000;

/** held back for the preprompt and tool schemas where the caller cannot measure them */
const PROMPT_OVERHEAD_TOKENS = 4_000;

function legacyBudgetChars(contextLengthTokens?: number, maxOutputTokens?: number): number {
	if (!contextLengthTokens || contextLengthTokens <= 0) return LEGACY_HISTORY_BUDGET_CHARS;
	const outputReserve =
		maxOutputTokens && maxOutputTokens > 0 ? maxOutputTokens : DEFAULT_OUTPUT_TOKENS;
	const usableTokens = Math.max(0, contextLengthTokens - outputReserve - PROMPT_OVERHEAD_TOKENS);
	return Math.min(LEGACY_HISTORY_BUDGET_CHARS, usableTokens * CHARS_PER_TOKEN);
}

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

const isToolResultUpdate = (u: MessageUpdate): u is MessageToolResultUpdate =>
	u.type === MessageUpdateType.Tool && u.subtype === MessageToolUpdateType.Result;
const isToolErrorUpdate = (u: MessageUpdate): u is MessageToolErrorUpdate =>
	u.type === MessageUpdateType.Tool && u.subtype === MessageToolUpdateType.Error;

/**
 * Whether a historical message's own producer (its persisted
 * `routerMetadata.model`, set for messages generated through the "omni"
 * router alias) matches the model about to consume the request. A message
 * with no routerMetadata was produced by whatever single model the
 * conversation is pinned to — the common case — and is always treated as
 * same-producer since there is nothing to contradict. Reasoning is
 * conditioned on the producing model's own prior thoughts; attaching one
 * model's reasoning_content to a different model's turn is unverified and
 * skipped rather than risked. Tool call/result replay is protocol-neutral
 * (a `tool` message is just data) and is never gated by this.
 */
function reasoningProducerMatches(
	message: EndpointMessage,
	currentProducerModel?: string
): boolean {
	const producer = message.routerMetadata?.model;
	return !producer || !currentProducerModel || producer === currentProducerModel;
}

/**
 * Split `<think>` blocks out of assistant text, merging them with the
 * separately persisted `message.reasoning` when present. Parts are returned
 * individually so replay can pair round reasoning back to its tool round.
 * Parts are filtered by whether they're non-blank but kept byte-exact
 * otherwise: vendors documenting preserved thinking can require the
 * reasoning payload sent back unmodified, so trimming must only decide
 * whether a part counts as empty, never change what gets echoed.
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
	const parts = [storedReasoning ?? "", ...thinkParts].filter((part) => part.trim().length > 0);
	return { visible: visible.trim(), parts };
}

interface TurnRound {
	calls: MessageToolCallUpdate[];
	/** byte exact, see splitReasoning */
	reasoning: string;
	/** visible text streamed before the calls, trimmed */
	content: string;
}

/**
 * either stored shape, cut on the live loop boundaries so a history window can drop whole rounds
 * without separating a tool result from its call
 */
function turnRounds(message: EndpointMessage): {
	rounds: TurnRound[];
	final: { content: string; reasoning: string };
} {
	const rounds = toolRounds(message.updates ?? []).map(({ calls }) => ({
		calls,
		reasoning: calls.find((u) => u.reasoning?.trim())?.reasoning ?? "",
		content: (calls.find((u) => u.content?.trim())?.content ?? "").trim(),
	}));
	if (message.contentShape === ROUNDS_SHAPE) {
		return {
			rounds,
			final: { content: message.content.trim(), reasoning: message.reasoning ?? "" },
		};
	}
	return { rounds, final: legacyFinalAnswer(message, rounds) };
}

/** the original shape keeps every round think block and preamble in content too */
function legacyFinalAnswer(
	message: EndpointMessage,
	rounds: TurnRound[]
): { content: string; reasoning: string } {
	const { visible, parts } = splitReasoning(message.content, message.reasoning);
	// `parts` holds every recovered reasoning block across the whole turn, and
	// `remainingVisible` the full visible text: when tools ran, the
	// FinalAnswer handler merges the pre-tool stream into content, so earlier
	// rounds' think blocks and preamble text survive there too, concatenated
	// in chronological order. Rounds whose Call update persisted its own
	// `reasoning`/`content` (written by the live loop since those fields
	// existed) reclaim their piece below; whatever remains belongs to the
	// final answer.
	const remainingParts = [...parts];
	let remainingVisible = visible;
	for (const round of rounds) {
		if (round.reasoning) {
			const exact = remainingParts.indexOf(round.reasoning);
			if (exact !== -1) {
				remainingParts.splice(exact, 1);
			} else if (remainingParts.length > 0 && round.reasoning.includes(remainingParts[0])) {
				// Positional fallback only, never a scan of the whole array: parts
				// are chronologically ordered and rounds are processed oldest-first,
				// so the earliest still-unconsumed part is the only one that can be
				// attributed to this round when exact match fails (e.g. formatting
				// drift). A LATER part merely being a substring of this round's
				// reasoning is coincidence, not evidence it belongs here — removing
				// it would silently delete an unrelated (and possibly the final
				// answer's own) reasoning block.
				remainingParts.splice(0, 1);
			}
		}
		// Visible text streamed before this round's calls (e.g. "Let me check
		// that."): rounds are processed oldest-first, matching the
		// chronological order text was concatenated into `message.content`, so
		// removing a matched prefix keeps the remainder correctly ordered for
		// the final message. Trimmed on both sides (persistence trims too)
		// because `remainingVisible` comes from splitReasoning trim-normalized;
		// visible text has no byte-exactness requirement, unlike reasoning.
		if (round.content && remainingVisible.startsWith(round.content)) {
			// Prefix-only, deliberately: rounds consume the visible text in
			// chronological order, so a streamed preamble is always the next
			// prefix. A persisted preamble that is NOT a prefix was never merged
			// into stored content (content arriving in the same delta as the
			// first tool_calls entry is suppressed from the stream), so a deeper
			// indexOf match could only hit identical text belonging to the final
			// answer — removing that would reorder the conversation. The failure
			// mode of not matching is mild duplication, which is safer.
			remainingVisible = remainingVisible.slice(round.content.length).trimStart();
		}
	}
	return { content: remainingVisible.trim(), reasoning: remainingParts.join("\n") };
}

/**
 * Rebuild a past assistant turn from its persisted tool updates so follow-up
 * requests see the tool calls and their outputs instead of a flat text
 * summary. Rounds are inferred from update order — a Call update arriving
 * after any Result/Error starts a new round, matching how the live loop emits
 * one batch of calls per completion round. Each call's `tool_call_id` is
 * always the normalized id from toToolCallId, even though the original
 * provider-issued id may also be persisted (see MessageToolCallUpdate):
 * emitting it unconditionally keeps one code path and satisfies every
 * provider's id-shape requirements, including Mistral-family templates.
 */
function replayAssistantTurn(
	message: EndpointMessage,
	includeReasoning: boolean,
	capToolOutputs: boolean
): AssistantReplayMessage[] {
	const updates = message.updates ?? [];
	const { rounds, final } = turnRounds(message);
	// null, not an empty-content message, when a turn was interrupted before
	// producing any final text or reasoning (e.g. aborted mid-tool-call): an
	// empty trailing `{role: "assistant", content: ""}` with nothing else
	// attached represents an assistant turn that never happened, and strict
	// providers can reject it outright.
	const buildFinalMessage = (): AssistantReplayMessage | null => {
		const hasReasoning = includeReasoning && final.reasoning.length > 0;
		if (final.content.length === 0 && !hasReasoning) return null;
		return {
			role: "assistant",
			content: final.content,
			...(hasReasoning ? { reasoning_content: final.reasoning } : {}),
		};
	};

	if (rounds.length === 0) {
		const finalMessage = buildFinalMessage();
		return finalMessage ? [finalMessage] : [];
	}

	const outputsByUuid = new Map<string, string>();
	const eventsByUuid = new Map<string, string[]>();
	for (const update of updates) {
		if (isToolResultUpdate(update)) {
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
		} else if (isToolErrorUpdate(update)) {
			outputsByUuid.set(update.uuid, `Error: ${update.message}`);
		} else if (update.type === MessageUpdateType.HarnessEvent) {
			const texts = eventsByUuid.get(update.afterToolUuid) ?? [];
			eventsByUuid.set(update.afterToolUuid, [...texts, update.text]);
		}
	}

	const usedIds = new Set<string>();
	const idByUuid = new Map(
		rounds.flatMap(({ calls }) => calls).map((u) => [u.uuid, toToolCallId(u.uuid, usedIds)])
	);

	const replayed: AssistantReplayMessage[] = [];
	for (const { calls: callsInRound, reasoning, content: roundContent } of rounds) {
		const roundReasoning = includeReasoning ? reasoning : "";
		// `content` is included only when a preamble was actually persisted
		// (messages recorded before this field existed have none); omitted
		// otherwise since some OpenAI-compatible backends reject empty text
		// next to tool_calls with a 400.
		// Arguments prefer the persisted raw JSON string the model actually
		// sent (argumentsRaw): the sanitized fallback only keeps top-level
		// primitive params (nested values and file payloads are deliberately
		// kept out of storage), so it can under-represent the real call.
		// Legacy updates without argumentsRaw, and any argumentsRaw that
		// somehow isn't valid JSON (toolInvocation.ts already guards this at
		// write time, but a replayed value must never be trusted blindly at
		// its own read boundary — belt and suspenders against a future write
		// path or manipulated data), fall back to the sanitized form.
		replayed.push({
			role: "assistant",
			tool_calls: callsInRound.map((u) => ({
				id: idByUuid.get(u.uuid) ?? u.uuid,
				type: "function" as const,
				function: {
					name: u.call.name,
					arguments:
						u.argumentsRaw && isValidJsonObject(u.argumentsRaw)
							? u.argumentsRaw
							: JSON.stringify(u.call.parameters ?? {}),
				},
			})),
			...(roundContent.trim().length > 0 ? { content: roundContent } : {}),
			...(roundReasoning ? { reasoning_content: roundReasoning } : {}),
		});
		for (const u of callsInRound) {
			// A call with no persisted outcome means the run was aborted
			// mid-execution; say so instead of fabricating an empty success.
			const output = outputsByUuid.has(u.uuid)
				? (outputsByUuid.get(u.uuid) ?? "")
				: "Error: interrupted before a result was recorded";
			const capped =
				capToolOutputs && output.length > MAX_REPLAYED_TOOL_OUTPUT_CHARS
					? stripLoneSurrogates(output.slice(0, MAX_REPLAYED_TOOL_OUTPUT_CHARS)) +
						"\n[...truncated]"
					: output;
			replayed.push({
				role: "tool",
				tool_call_id: idByUuid.get(u.uuid) ?? u.uuid,
				// the event goes on after the cap, a long output never cuts it
				content: (eventsByUuid.get(u.uuid) ?? []).reduce(withHarnessEvent, capped),
			});
		}
	}
	const finalMessage = buildFinalMessage();
	if (finalMessage) replayed.push(finalMessage);
	return replayed;
}

type ReplayCandidate = { replay: AssistantReplayMessage[]; flat: ChatMessageParam };
type PreparedEntry = ChatMessageParam[] | ReplayCandidate;

/** the stored path, ids are there at runtime even though the endpoint type omits them */
export type HistoryMessage = EndpointMessage & { id?: string };

export type HistoryOptions = {
	replayToolHistory?: boolean;
	attachReasoning?: boolean;
	currentProducerModel?: string;
	/** context window of the consuming model in tokens, when it reports one */
	contextLengthTokens?: number;
	/** the reply allowance this request asks for, reserved from the window */
	maxOutputTokens?: number;
	/** HISTORY_SLIDING_WINDOW, off keeps the legacy budget and its per-output cap */
	slidingWindow?: boolean;
	/** where the window start is kept, without it every request picks its own start */
	window?: { conversationId: ObjectId; stored?: StoredHistoryWindow };
	/** minimal after the provider refused the request for its size */
	attachments?: AttachmentMode;
	/** the truncation marker points at jobs and sandboxes */
	mlAssistant?: boolean;
	onAttachments?: (report: AttachmentReport) => void;
};

/**
 * Prepare chat messages for OpenAI-compatible multimodal payloads.
 * - Processes images via the provided imageProcessor (resize/convert) when multimodal is enabled.
 * - Injects text-file content into the user message text.
 * - Leaves messages untouched when no files or multimodal disabled.
 * - Historical assistant `<think>` blocks are always stripped from outgoing
 *   content, whether or not any reasoning option below is set: raw think
 *   markup must never be replayed as visible text to any model.
 * - With `replayToolHistory`, expands past assistant turns into their
 *   assistant/tool message pairs (from persisted updates) and re-attaches
 *   reasoning as `reasoning_content` instead of inline `<think>` text.
 * - With `attachReasoning`, only the reasoning half: assistant turns stay
 *   flat but carry `reasoning_content`, for tool-less requests where replayed
 *   tool messages would be undefined behavior (no `tools` in the request).
 *   Callers gate it on the model's reasoning capability; with
 *   `replayToolHistory` it defaults to on unless explicitly disabled.
 * - `currentProducerModel` additionally gates reasoning_content per message:
 *   a message routed (via the router alias) to a different model than the
 *   one about to consume this request has its reasoning suppressed, since
 *   reasoning is conditioned on the producing model's own prior thoughts.
 *   Messages with no routerMetadata (the common pinned-model case) are
 *   unaffected. Tool call/result replay is protocol-neutral and always
 *   proceeds regardless of producer.
 */
export async function prepareMessagesWithFiles(
	messages: HistoryMessage[],
	imageProcessor: ReturnType<typeof makeImageProcessor>,
	isMultimodal: boolean,
	options?: HistoryOptions
): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[]> {
	const history = await prepareHistory(messages, imageProcessor, isMultimodal, options);
	options?.onAttachments?.(history.attachments);
	if (!history.units || !options?.contextLengthTokens) return history.messages;
	const limitChars = windowLimitChars(options.contextLengthTokens, options.maxOutputTokens);
	const fixedChars = PROMPT_OVERHEAD_TOKENS * CHARS_PER_TOKEN;
	if (!options.window) {
		return renderWindow(history.units, planWindow(history.units, { limitChars, fixedChars }));
	}
	return createHistoryWindow({
		conversationId: options.window.conversationId,
		units: history.units,
		offset: 0,
		limitChars,
		fixedChars,
		stored: options.window.stored,
	}).fit(history.messages);
}

/**
 * the whole history replayed in full, with its units when the sliding window applies, a caller
 * that gets no units has the legacy budgeted history
 */
export async function prepareHistory(
	messages: HistoryMessage[],
	imageProcessor: ReturnType<typeof makeImageProcessor>,
	isMultimodal: boolean,
	options?: HistoryOptions
): Promise<{ messages: ChatMessageParam[]; units?: HistoryUnit[]; attachments: AttachmentReport }> {
	const sliding = Boolean(
		options?.slidingWindow && options.contextLengthTokens && options.contextLengthTokens > 0
	);
	const { prepared, attachments } = await prepareEntries(
		messages,
		imageProcessor,
		isMultimodal,
		options,
		!sliding
	);
	if (!sliding) return { messages: legacyBudget(prepared, options), attachments };
	const units = historyUnits(messages, prepared);
	return { messages: units.flatMap((unit) => unit.messages), units, attachments };
}

function historyUnits(messages: HistoryMessage[], prepared: PreparedEntry[]): HistoryUnit[] {
	return prepared.flatMap((entry, i): HistoryUnit[] => {
		const message = messages[i];
		const replayed = Array.isArray(entry) ? entry : entry.replay;
		if (message.from === "system") return [{ messages: replayed, head: true, rounds: 0 }];
		const start = (round: number) => (message.id ? { messageId: message.id, round } : undefined);
		if (message.from === "user") {
			return [{ messages: replayed, opensTurn: true, rounds: 0, start: start(0) }];
		}
		let round = 0;
		return groupRounds(replayed).map((group) => {
			const isRound = group[0].role === "assistant" && (group[0].tool_calls?.length ?? 0) > 0;
			const unit: HistoryUnit = {
				messages: group,
				rounds: isRound ? 1 : 0,
				start: start(round),
				question: isRound ? answeredQuestion(group) : undefined,
			};
			if (isRound) round += 1;
			return unit;
		});
	});
}

async function prepareEntries(
	messages: HistoryMessage[],
	imageProcessor: ReturnType<typeof makeImageProcessor>,
	isMultimodal: boolean,
	options: HistoryOptions | undefined,
	capToolOutputs: boolean
): Promise<{ prepared: PreparedEntry[]; attachments: AttachmentReport }> {
	const { contentOf, report } = await prepareAttachments(messages, imageProcessor, isMultimodal, {
		limitChars: options?.contextLengthTokens
			? windowLimitChars(options.contextLengthTokens, options.maxOutputTokens)
			: undefined,
		mode: options?.attachments,
		mlAssistant: options?.mlAssistant,
	});
	const prepared = messages.map((message, index): PreparedEntry => {
		if (message.from === "user") {
			return [{ role: "user", content: contentOf(index) }];
		}
		if (message.from === "assistant") {
			const wantsReasoning =
				(options?.replayToolHistory
					? (options?.attachReasoning ?? true)
					: Boolean(options?.attachReasoning)) &&
				reasoningProducerMatches(message, options?.currentProducerModel);

			// flat forms need every round text, which the rounds shape keeps out of content
			const legacy = rebuildLegacyContent(message);
			if (options?.replayToolHistory) {
				// The budget-fallback `flat` must still strip <think>, not just
				// drop the reasoning_content/tool-replay enrichments: the raw
				// string leaks reasoning as visible content to every model that
				// falls back to it, including ones (e.g. Gemma) whose vendor
				// requires historical thoughts to be stripped regardless of the
				// replay budget.
				const flat: ChatMessageParam = {
					role: "assistant",
					content: stripThink(legacy.content),
				};
				return {
					replay: replayAssistantTurn(message, wantsReasoning, capToolOutputs),
					flat,
				};
			}
			const { visible, parts } = splitReasoning(legacy.content, legacy.reasoning);
			const reasoning = parts.join("\n");
			if (!wantsReasoning || reasoning.length === 0) {
				// Either nothing to attach, or attachment is disabled/gated:
				// either way `visible` (think-stripped) is the correct shape,
				// never the raw `message.content` — but a turn interrupted
				// before any visible text (or one whose only content was
				// reasoning this call is gated from attaching) must not replay
				// as a phantom `{role: assistant, content: ""}` with nothing
				// else attached; omit it entirely instead.
				return visible.length > 0 ? [{ role: "assistant", content: visible }] : [];
			}
			// Candidate, not a plain array, so the reasoning payload goes
			// through the same newest-first budget as tool replay. The
			// fallback keeps the same stripped `visible` text and just
			// drops reasoning_content, for the same reason as above.
			return {
				replay: [{ role: "assistant", content: visible, reasoning_content: reasoning }],
				flat: { role: "assistant", content: visible },
			};
		}
		return [{ role: message.from, content: message.content }];
	});
	return { prepared, attachments: report };
}

function legacyBudget(prepared: PreparedEntry[], options?: HistoryOptions): ChatMessageParam[] {
	// Spend the replay budget newest-first so recent turns keep their full
	// tool history and older ones degrade to the pre-replay flat shape. The
	// degradation is monotonic: once any turn falls back to flat, every older
	// turn does too, so the model never sees rich history for a stale turn
	// while the turn it is continuing from is plain prose.
	// Two passes, because the budget caps the whole request and the messages that
	// can't degrade aren't all at the newest end. Charging them as they're
	// reached would let a huge older user turn be counted only after every newer
	// turn had already been granted its replay — the total would still overrun.
	//
	// Pass 1 establishes the floor: what this request costs with no enrichment
	// at all, which is also the exact shape it had before replay existed.
	const flatForms: ChatMessageParam[][] = prepared.map((entry) => {
		if (Array.isArray(entry)) return entry;
		// Same phantom-turn guard as the replay and plain branches: an
		// interrupted turn whose stripped content is empty must be omitted,
		// not sent as {role: "assistant", content: ""}.
		const flatContent = typeof entry.flat.content === "string" ? entry.flat.content : "";
		return flatContent.trim().length > 0 ? [entry.flat] : [];
	});
	const floor = flatForms.reduce((total, form) => total + historyCost(form), 0);

	// Pass 2 spends whatever is left on upgrading turns to their replayed shape,
	// paying only the difference over the floor. A history that already exceeds
	// the cap leaves nothing to spend, so every turn keeps its flat form and the
	// request is no larger than it used to be.
	const total = legacyBudgetChars(options?.contextLengthTokens, options?.maxOutputTokens);
	const windowBounded = Boolean(options?.contextLengthTokens && options.contextLengthTokens > 0);
	let budget = total - floor;
	const resolved: ChatMessageParam[][] = [...flatForms];
	// The newest replayable turn is the one a continuation resumes INTO: its
	// tool transcript is the run's working state (parked waits, submitted jobs,
	// answered questions), and flattening it decapitates the run — the resumed
	// model literally forgets what it did. Against the SOFT ceiling (no window
	// reported) it is therefore judged against the whole budget, not what the
	// floor left over: history ballast can flatten older turns, never the one
	// being continued, and over-sending against the soft ceiling is survivable.
	// A WINDOW-bounded budget is physics, not policy: replay past it fails the
	// whole request with a provider context error, which is strictly worse than
	// the flat degradation — so there the newest turn must fit beside the flat
	// floor like everything else (walking newest-first, it still claims the
	// budget first).
	let newestCandidate = true;
	const newestLimit = windowBounded ? budget : total;
	for (let i = prepared.length - 1; i >= 0; i -= 1) {
		const entry = prepared[i];
		if (Array.isArray(entry)) continue;
		const upgrade = historyCost(entry.replay) - historyCost(flatForms[i]);
		// Monotonic past the newest turn: the first older turn that doesn't fit
		// stops the walk, so the model never sees rich history for a stale turn
		// while a newer one is plain prose.
		if (newestCandidate ? upgrade > newestLimit : upgrade > budget) break;
		newestCandidate = false;
		budget -= upgrade;
		resolved[i] = entry.replay;
	}
	return resolved.flat();
}
