/**
 * Compatibility + semantic + speed harness for the reasoning/tool-history
 * replay changes.
 *
 * Sends synthetic conversations to a pinned cohort of router models (see
 * PINNED_MODELS) in several shapes and compares acceptance, semantic
 * correctness, and streaming speed:
 *   S1 baseline  — flat {role, content} history (previous prod behavior)
 *   S2 replay    — output of prepareMessagesWithFiles({replayToolHistory: true})
 *   S3 in-loop   — S2 with reasoning_content on a tool-call assistant message
 *                  and `content` omitted (the shape runMcpFlow sends between
 *                  tool rounds)
 *   P1/P2        — tool-less flow, flat vs reasoning_content attached
 *   N1/N2        — semantic proof (see below), not just shape acceptance
 *
 * N1/N2 close the harness's biggest evidentiary gap: S1-S3's stored tool
 * result already restates the facts (Paris, 18°C) in the visible assistant
 * answer, so a model can answer the follow-up correctly from the flat
 * baseline without ever needing replayed history — shape acceptance was
 * being mistaken for semantic proof. N1/N2 instead fabricate a tool result
 * containing a nonce that appears NOWHERE in visible content, then ask for
 * it: only a model that actually received the replayed tool history can
 * answer, so N2-nonce-replay containing the nonce is direct proof replay
 * works, not just that the provider accepted the payload shape.
 *
 * Requests stream (like prod) and are repeated REPS times sequentially per
 * model/scenario, models in parallel, measuring time-to-first-token and
 * generation throughput (approximated from SSE delta chunks).
 *
 * Ship criteria (both gate the exit code):
 *   1. Every model that accepts a baseline scenario must also accept its
 *      dependent scenarios (see FAMILIES) — shape-acceptance regression.
 *   2. Every model that accepts N2-nonce-replay must produce the nonce in
 *      its answer — semantic regression, independent of (1).
 *
 * Run it the same way as the other repo scripts (see "populate" in
 * package.json), passing this file's path to vite-node.
 */
import { readFileSync } from "fs";
import { prepareMessagesWithFiles } from "$lib/server/textGeneration/utils/prepareFiles";
import { preservesReasoningByDefault } from "$lib/server/reasoningPolicy";
import type { EndpointMessage } from "$lib/server/endpoints/endpoints";
import type { makeImageProcessor } from "$lib/server/endpoints/images";
import { MessageToolUpdateType, MessageUpdateType } from "$lib/types/MessageUpdate";
import { ToolResultStatus } from "$lib/types/Tool";
import type { OpenAI } from "openai";

const REPS = 2;
const REQUEST_TIMEOUT_MS = 90_000;
// Reasoning models can spend 250-450+ tokens thinking before emitting any
// visible content, especially when the answer requires recalling a specific
// fact (the nonce scenarios). A tighter budget was observed cutting content
// to empty (finish_reason: "length") after reasoning alone exhausted it.
const MAX_TOKENS = 400;

/**
 * Pinned to the models this PR's research established a preservation policy
 * for (see the PR body's vendor-guidance table), plus two controls, instead
 * of "first N from /models": an unpinned population drifts across runs and
 * says nothing about whether the models this PR actually targets behave.
 * gemma-4-31B-it and Llama-3.1-8B-Instruct are controls — Gemma's vendor
 * requires stripping historical thoughts (must stay unflagged, must NOT gain
 * cross-turn reasoning_content), Llama has no reasoning mechanism at all.
 */
const PINNED_MODELS = [
	"moonshotai/Kimi-K3",
	"moonshotai/Kimi-K2.7-Code",
	"MiniMaxAI/MiniMax-M3",
	"deepseek-ai/DeepSeek-V4-Flash",
	"deepseek-ai/DeepSeek-V4-Pro",
	"zai-org/GLM-5.2",
	"Qwen/Qwen3.6-27B",
	"Qwen/Qwen3.6-35B-A3B",
	"google/gemma-4-31B-it",
	"meta-llama/Llama-3.1-8B-Instruct",
];

/**
 * Resolves each pinned model the way production now does, so every
 * reasoning-bearing scenario (S2/S3/P2/N2 below) is built with the same gate
 * value it would really get. Sending a model a shape production never sends it
 * proves nothing about its real policy and fails it for a payload it will
 * never receive.
 *
 * Replay is on by default and blocked per family rather than opted into, so
 * this delegates to the production policy instead of restating a flag table —
 * a table would drift the moment a model was added, which is the failure mode
 * the flip exists to remove. Only gemma is blocked today; Llama is unaffected
 * either way because it emits no reasoning to replay.
 */
const modelPreservesReasoning = (model: string) => preservesReasoningByDefault(model);

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam & {
	reasoning_content?: string;
};

function loadEnv(): { baseUrl: string; apiKey: string } {
	const env = new Map<string, string>();
	for (const file of [".env", ".env.local"]) {
		try {
			for (const line of readFileSync(file, "utf-8").split("\n")) {
				const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
				if (match) env.set(match[1], match[2].replace(/^["']|["']$/g, ""));
			}
		} catch {
			// file optional
		}
	}
	const baseUrl =
		process.env.OPENAI_BASE_URL ?? env.get("OPENAI_BASE_URL") ?? "https://router.huggingface.co/v1";
	const apiKey = process.env.OPENAI_API_KEY ?? env.get("OPENAI_API_KEY") ?? "";
	if (!apiKey) throw new Error("No OPENAI_API_KEY found in env or .env.local");
	return { baseUrl: baseUrl.replace(/\/$/, ""), apiKey };
}

const TOOLS = [
	{
		type: "function" as const,
		function: {
			name: "get_weather",
			description: "Get the current weather for a city",
			parameters: {
				type: "object",
				properties: { city: { type: "string" } },
				required: ["city"],
			},
		},
	},
	{
		type: "function" as const,
		function: {
			name: "get_forecast",
			description: "Get the 7-day forecast for a city",
			parameters: {
				type: "object",
				properties: { city: { type: "string" } },
				required: ["city"],
			},
		},
	},
];

const SYSTEM = "You are a helpful assistant. Answer concisely.";
const THINK =
	"<think>The user wants current weather in Paris. I called get_weather which returned 18°C and sunny, then get_forecast which says sunny all week.</think>";
const ASSISTANT_VISIBLE =
	"It's currently 18°C and sunny in Paris, and the forecast says sunny all week.";
const FOLLOW_UP =
	"In one short sentence: which city did I ask about, and what temperature did the weather tool report?";

/** The stored conversation, exactly as chat-ui would persist it. */
const storedHistory: EndpointMessage[] = [
	{ from: "user", content: "What's the weather in Paris right now? Also check the forecast." },
	{
		from: "assistant",
		content: THINK + ASSISTANT_VISIBLE,
		updates: [
			{
				type: MessageUpdateType.Tool,
				subtype: MessageToolUpdateType.Call,
				uuid: "call-1",
				call: { name: "get_weather", parameters: { city: "Paris" } },
			},
			{
				type: MessageUpdateType.Tool,
				subtype: MessageToolUpdateType.Result,
				uuid: "call-1",
				result: {
					status: ToolResultStatus.Success,
					call: { name: "get_weather", parameters: { city: "Paris" } },
					outputs: [{ text: "18°C, sunny, humidity 60%" }],
				},
			},
			{
				type: MessageUpdateType.Tool,
				subtype: MessageToolUpdateType.Call,
				uuid: "call-2",
				call: { name: "get_forecast", parameters: { city: "Paris" } },
			},
			{
				type: MessageUpdateType.Tool,
				subtype: MessageToolUpdateType.Result,
				uuid: "call-2",
				result: {
					status: ToolResultStatus.Success,
					call: { name: "get_forecast", parameters: { city: "Paris" } },
					outputs: [{ text: "Sunny all week, highs around 20°C" }],
				},
			},
		],
	},
	{ from: "user", content: FOLLOW_UP },
];

const imageProcessor = (() => {
	throw new Error("unused");
}) as unknown as ReturnType<typeof makeImageProcessor>;

/**
 * A nonce that appears ONLY in the fabricated tool result, never in the
 * assistant's visible content — the semantic proof scenario's whole point.
 * High-entropy enough that a model cannot plausibly guess or hallucinate it.
 */
const NONCE = "Q7M4-XP29";

/**
 * Same shape as storedHistory, but the tool result carries a fact (the
 * nonce) that the visible assistant answer never restates. Flat history
 * drops the tool entirely, so a model can only produce the nonce in the
 * follow-up if it actually saw replayed tool history — unlike storedHistory
 * above, where the visible answer already gives away every fact the
 * follow-up asks about.
 *
 * Framed as a weather station id, not "internal_reference": an early version
 * used that field name and a safety-tuned model (Kimi-K3) correctly recalled
 * it in its own reasoning_content but then refused to repeat it, reading
 * "internal" as "not meant for the user" — a fixture-wording false negative,
 * not a replay failure. A station id has no such ambiguity.
 */
const storedNonceHistory: EndpointMessage[] = [
	{ from: "user", content: "What's the weather in Paris right now?" },
	{
		from: "assistant",
		content: "<think>Checking the weather tool.</think>It's sunny and mild in Paris right now.",
		updates: [
			{
				type: MessageUpdateType.Tool,
				subtype: MessageToolUpdateType.Call,
				uuid: "nonce-call-1",
				call: { name: "get_weather", parameters: { city: "Paris" } },
			},
			{
				type: MessageUpdateType.Tool,
				subtype: MessageToolUpdateType.Result,
				uuid: "nonce-call-1",
				result: {
					status: ToolResultStatus.Success,
					call: { name: "get_weather", parameters: { city: "Paris" } },
					outputs: [{ text: `Sunny, 19°C. station_id=${NONCE}` }],
				},
			},
		],
	},
	{
		from: "user",
		content:
			"In one short sentence: what weather station ID did the tool report? It looked like XXXX-XXXX.",
	},
];

/** Tool-less two-turn conversation for the plain-flow scenarios. */
const storedPlainHistory: EndpointMessage[] = [
	{ from: "user", content: "If a train travels 120 km in 1.5 hours, what is its average speed?" },
	{
		from: "assistant",
		content: "<think>120 divided by 1.5 is 80, so 80 km/h.</think>The average speed is 80 km/h.",
	},
	{
		from: "user",
		content: "In one short sentence: what speed did you compute in your previous answer?",
	},
];

/**
 * A turn that ended before producing any final answer: the tool ran, then the
 * follow-up completion died or the user navigated away. #2472 keeps that work
 * instead of discarding it, so the turn persists and gets replayed.
 *
 * Replay omits the trailing assistant message (an empty one represents a turn
 * that never happened, and strict providers reject it), which leaves the
 * payload going `tool` -> `user` with no assistant between them. That is a
 * shape production never emitted before replay existed, and Mistral-family
 * chat templates in particular enforce role alternation. Only a real provider
 * can answer whether it is accepted — which is why this lives here and not in
 * the offline spec that proves the shape is produced.
 */
const storedInterruptedHistory: EndpointMessage[] = [
	{ from: "user", content: "What's the weather in Paris right now?" },
	{
		from: "assistant",
		content: "",
		updates: [
			{
				type: MessageUpdateType.Tool,
				subtype: MessageToolUpdateType.Call,
				uuid: "interrupted-call-1",
				call: { name: "get_weather", parameters: { city: "Paris" } },
			},
			{
				type: MessageUpdateType.Tool,
				subtype: MessageToolUpdateType.Result,
				uuid: "interrupted-call-1",
				result: {
					status: ToolResultStatus.Success,
					call: { name: "get_weather", parameters: { city: "Paris" } },
					outputs: [{ text: "18°C, sunny" }],
				},
			},
		],
	},
	{ from: "user", content: "In one short sentence: what is the weather in Paris?" },
];

/**
 * A tool whose result carried no text at all — what an image-only MCP tool
 * produces, since the client joins only text blocks. Replay emits
 * `{role: "tool", content: ""}`; some OpenAI-compatible backends reject empty
 * tool content outright, and those that accept it are told the tool returned
 * nothing.
 */
const storedEmptyToolHistory: EndpointMessage[] = [
	{ from: "user", content: "Chart the weather in Paris." },
	{
		from: "assistant",
		content: "Here is the chart.",
		updates: [
			{
				type: MessageUpdateType.Tool,
				subtype: MessageToolUpdateType.Call,
				uuid: "empty-call-1",
				call: { name: "get_weather", parameters: { city: "Paris" } },
			},
			{
				type: MessageUpdateType.Tool,
				subtype: MessageToolUpdateType.Result,
				uuid: "empty-call-1",
				result: {
					status: ToolResultStatus.Success,
					call: { name: "get_weather", parameters: { city: "Paris" } },
					outputs: [{ text: "" }],
				},
			},
		],
	},
	{ from: "user", content: "In one short sentence: describe the chart you made." },
];

type Scenario = {
	name: string;
	messages: ChatMessage[];
	withTools: boolean;
	expect: RegExp[];
	/**
	 * Semantic gate on the final answer text, independent of `expect`:
	 * "must-contain" fails the scenario (regardless of HTTP-level success) if
	 * the nonce is absent; "must-not-contain" is informational only (logged,
	 * never gates) — a sanity check that the flat baseline truly has no way
	 * to know the nonce.
	 */
	nonceCheck?: "must-contain" | "must-not-contain";
};

/** Baseline scenario name → scenarios that must not regress against it. */
const FAMILIES: Record<string, string[]> = {
	"S1-baseline": ["S2-replay", "S3-inloop", "A1-interrupted", "A2-empty-tool"],
	"P1-plain": ["P2-reasoning"],
};

/**
 * Builds the scenario set for one model. `supportsReasoning` is that model's
 * real production gate (see modelPreservesReasoning): it decides
 * attachReasoning for every reasoning-bearing scenario — S2/P2/N2 across
 * turns and S3 in-loop — the same way production resolves it, so a blocked
 * model is tested against the shape it will actually receive rather than one
 * forced uniformly onto every model.
 */
async function buildScenarios(supportsReasoning: boolean): Promise<Scenario[]> {
	const toolExpect = [/paris/i, /18/];
	const plainExpect = [/80/];
	const withSystem = (msgs: ChatMessage[]): ChatMessage[] => [
		{ role: "system", content: SYSTEM },
		...msgs,
	];

	const baseline = withSystem(await prepareMessagesWithFiles(storedHistory, imageProcessor, false));
	const replay = withSystem(
		await prepareMessagesWithFiles(storedHistory, imageProcessor, false, {
			replayToolHistory: true,
			attachReasoning: supportsReasoning,
		})
	);
	// S3: attach reasoning_content to the first tool-call assistant message,
	// mirroring what runMcpFlow sends between rounds of a live turn.
	//
	// Gated on the model's flag, like the cross-turn scenarios. It used to be
	// unconditional, because the in-loop echo used to be ungated in production
	// — which is precisely how this harness caught a provider that rejects the
	// field outright (400 on gemma-4-31B-it) rather than ignoring it. Now that
	// runMcpFlow gates the echo, sending it unconditionally here would test a
	// shape production no longer produces, and fail unflagged models for a
	// payload they will never receive.
	const inloop: ChatMessage[] = supportsReasoning
		? replay.map((m) =>
				m.role === "assistant" && "tool_calls" in m && m.tool_calls?.[0]?.id === "call10000"
					? {
							...m,
							reasoning_content: "The user wants current weather, calling get_weather first.",
						}
					: m
			)
		: replay;
	const plain = withSystem(
		await prepareMessagesWithFiles(storedPlainHistory, imageProcessor, false)
	);
	const plainReasoning = withSystem(
		await prepareMessagesWithFiles(storedPlainHistory, imageProcessor, false, {
			attachReasoning: supportsReasoning,
		})
	);
	const nonceFlat = withSystem(
		await prepareMessagesWithFiles(storedNonceHistory, imageProcessor, false)
	);
	// The nonce itself lives in the replayed tool RESULT, which is always
	// replayed unconditionally (tool replay is never gated by
	// attachReasoning) — so this scenario's semantic proof is unaffected by
	// supportsReasoning either way; it's threaded through purely so an
	// unflagged model isn't sent an unrealistic reasoning_content alongside it.
	const nonceReplay = withSystem(
		await prepareMessagesWithFiles(storedNonceHistory, imageProcessor, false, {
			replayToolHistory: true,
			attachReasoning: supportsReasoning,
		})
	);

	// Built through prepareMessagesWithFiles like every other scenario rather
	// than hand-written: the point is to send what production actually emits for
	// these histories, not an approximation of it.
	const interrupted = withSystem(
		await prepareMessagesWithFiles(storedInterruptedHistory, imageProcessor, false, {
			replayToolHistory: true,
			attachReasoning: supportsReasoning,
		})
	);
	const emptyTool = withSystem(
		await prepareMessagesWithFiles(storedEmptyToolHistory, imageProcessor, false, {
			replayToolHistory: true,
			attachReasoning: supportsReasoning,
		})
	);

	return [
		{ name: "S1-baseline", messages: baseline, withTools: true, expect: toolExpect },
		{ name: "S2-replay", messages: replay, withTools: true, expect: toolExpect },
		{ name: "S3-inloop", messages: inloop, withTools: true, expect: toolExpect },
		// Acceptance-only (no `expect`): these ask whether the provider tolerates
		// the shape at all. A coherence gate would conflate "rejected the payload"
		// with "answered vaguely", and the answer's content is not the question.
		{ name: "A1-interrupted", messages: interrupted, withTools: true, expect: [] },
		{ name: "A2-empty-tool", messages: emptyTool, withTools: true, expect: [] },
		{ name: "P1-plain", messages: plain, withTools: false, expect: plainExpect },
		{ name: "P2-reasoning", messages: plainReasoning, withTools: false, expect: plainExpect },
		{
			name: "N1-nonce-flat",
			messages: nonceFlat,
			withTools: true,
			expect: [],
			nonceCheck: "must-not-contain",
		},
		{
			name: "N2-nonce-replay",
			messages: nonceReplay,
			withTools: true,
			expect: [],
			nonceCheck: "must-contain",
		},
	];
}

type RunResult = {
	ok: boolean;
	ttftMs?: number;
	totalMs: number;
	genTokens: number;
	coherent?: boolean;
	/** Only set when scenario.nonceCheck is defined; see that field's doc. */
	nonceOk?: boolean;
	note: string;
};

/** One streaming request; TTFT = first delta carrying content/reasoning/tool_calls. */
async function runOne(
	baseUrl: string,
	apiKey: string,
	model: string,
	scenario: Scenario
): Promise<RunResult> {
	const started = Date.now();
	try {
		const res = await fetch(`${baseUrl}/chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
				"X-use-cache": "false",
			},
			body: JSON.stringify({
				model,
				messages: scenario.messages,
				...(scenario.withTools ? { tools: TOOLS, tool_choice: "auto" } : {}),
				temperature: 0,
				max_tokens: MAX_TOKENS,
				stream: true,
			}),
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		if (!res.ok || !res.body) {
			const body = (await res.text()).slice(0, 300).replace(/\s+/g, " ");
			return {
				ok: false,
				totalMs: Date.now() - started,
				genTokens: 0,
				note: `HTTP ${res.status}: ${body}`,
			};
		}

		let ttftMs: number | undefined;
		let genTokens = 0;
		let content = "";
		let sawToolCall = false;
		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) {
				if (!line.startsWith("data:")) continue;
				const payload = line.slice(5).trim();
				if (!payload || payload === "[DONE]") continue;
				let delta: Record<string, unknown> | undefined;
				try {
					const parsed = JSON.parse(payload) as {
						choices?: Array<{ delta?: Record<string, unknown> }>;
					};
					delta = parsed.choices?.[0]?.delta;
				} catch {
					continue;
				}
				if (!delta) continue;
				const text =
					(typeof delta.content === "string" ? delta.content : "") +
					(typeof delta.reasoning === "string" ? delta.reasoning : "") +
					(typeof delta.reasoning_content === "string" ? delta.reasoning_content : "") +
					(typeof delta.reasoning_text === "string" ? delta.reasoning_text : "");
				const hasToolCall = Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0;
				if (hasToolCall) sawToolCall = true;
				if (text.length > 0 || hasToolCall) {
					ttftMs ??= Date.now() - started;
					genTokens += 1;
				}
				if (typeof delta.content === "string") content += delta.content;
			}
		}
		const totalMs = Date.now() - started;
		content = content.trim();
		if (!content && !sawToolCall && genTokens === 0) {
			return { ok: false, ttftMs, totalMs, genTokens, note: "empty response" };
		}
		// An empty final answer cannot satisfy an `expect` check, so it counts as
		// incoherent rather than unjudged. Left as `undefined` it passed the
		// regression gate, which meant a rep that streamed only reasoning — or
		// returned tool_calls and never got to an answer — could satisfy S2/S3 or
		// P2 without ever producing the text the scenario exists to check for.
		// Scenarios carrying no expectations (the acceptance-only ones, which ask
		// whether a payload shape is tolerated at all) stay unjudged.
		const coherent =
			scenario.expect.length === 0
				? undefined
				: content.length > 0 && scenario.expect.every((re) => re.test(content));
		// A tool-calls-only response (no text) never satisfies a nonce check:
		// the semantic proof requires the fact to appear in the model's actual
		// answer, not just that some request happened to succeed.
		const nonceOk = scenario.nonceCheck
			? scenario.nonceCheck === "must-contain"
				? content.includes(NONCE)
				: !content.includes(NONCE)
			: undefined;
		return {
			ok: true,
			ttftMs,
			totalMs,
			genTokens,
			coherent,
			nonceOk,
			note: sawToolCall && !content ? "answered with tool_calls" : content.slice(0, 80),
		};
	} catch (err) {
		return {
			ok: false,
			totalMs: Date.now() - started,
			genTokens: 0,
			note: err instanceof Error ? `${err.name}: ${err.message.slice(0, 200)}` : String(err),
		};
	}
}

const median = (values: number[]): number | undefined => {
	if (values.length === 0) return undefined;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)];
};

type ScenarioStats = {
	scenario: string;
	ok: boolean;
	okCount: number;
	repCount: number;
	coherent?: boolean;
	/** Only meaningful when the scenario has nonceCheck: "must-contain". */
	nonceOk?: boolean;
	ttftMs?: number;
	tokPerSec?: number;
	totalMs?: number;
	note: string;
};

async function runModel(
	baseUrl: string,
	apiKey: string,
	model: string,
	scenarios: Scenario[]
): Promise<ScenarioStats[]> {
	const stats: ScenarioStats[] = [];
	for (const scenario of scenarios) {
		const runs: RunResult[] = [];
		for (let rep = 0; rep < REPS; rep += 1) {
			runs.push(await runOne(baseUrl, apiKey, model, scenario));
		}
		const okRuns = runs.filter((r) => r.ok);
		const speedRuns = okRuns.filter((r) => r.ttftMs !== undefined && r.genTokens > 1);
		// Require every repetition to pass: a scenario that succeeds once and
		// fails once (e.g. a request landing on a provider variant with
		// different schema validation) is a real half-failure, not a
		// compatibility pass. okCount/repCount surface the partial case
		// distinctly instead of rounding it up to "ok".
		// nonceOk is likewise strict: every successful rep must satisfy the
		// nonce check, not just one out of REPS.
		const nonceRuns = okRuns.filter((r) => r.nonceOk !== undefined);
		stats.push({
			scenario: scenario.name,
			ok: okRuns.length === runs.length,
			okCount: okRuns.length,
			repCount: runs.length,
			// Aggregate across every judged successful rep (like nonceOk): one
			// incoherent rep is a sampled semantic failure even if another rep
			// happened to answer well.
			coherent: okRuns.some((r) => r.coherent !== undefined)
				? okRuns.every((r) => r.coherent !== false)
				: undefined,
			nonceOk: nonceRuns.length > 0 ? nonceRuns.every((r) => r.nonceOk) : undefined,
			ttftMs: median(speedRuns.map((r) => r.ttftMs ?? 0)),
			tokPerSec: median(
				speedRuns.map(
					(r) => (r.genTokens - 1) / Math.max(0.001, (r.totalMs - (r.ttftMs ?? 0)) / 1000)
				)
			),
			totalMs: median(okRuns.map((r) => r.totalMs)),
			note: (okRuns[0] ?? runs[0]).note,
		});
	}
	return stats;
}

async function main() {
	const { baseUrl, apiKey } = loadEnv();
	console.log(`Base URL: ${baseUrl}`);

	const modelsRes = await fetch(`${baseUrl}/models`, {
		headers: { Authorization: `Bearer ${apiKey}` },
	});
	if (!modelsRes.ok) throw new Error(`GET /models failed: HTTP ${modelsRes.status}`);
	const modelsJson = (await modelsRes.json()) as { data?: Array<{ id: string }> };
	const availableIds = new Set((modelsJson.data ?? []).map((m) => m.id));
	const models = PINNED_MODELS.filter((id) => availableIds.has(id));
	const missing = PINNED_MODELS.filter((id) => !availableIds.has(id));
	if (missing.length > 0) {
		console.log(`Skipping pinned models no longer on the router: ${missing.join(", ")}`);
	}
	// An empty cohort (model churn, a misconfigured endpoint) would otherwise
	// fall through to zero regressions/zero semantic failures and print
	// SHIPPABLE without a single request sent — an indeterminate run must
	// fail loudly, not look identical to a clean pass.
	if (models.length === 0) {
		console.error(
			`No pinned models are available on the router (checked ${PINNED_MODELS.length}); nothing was tested.`
		);
		process.exit(1);
	}

	// Scenarios are built per model (attachReasoning depends on each model's
	// real supportsReasoning flag — see buildScenarios's doc comment), so log
	// representative payload sizes for both variants once instead of per model.
	for (const supportsReasoning of [true, false]) {
		const sample = await buildScenarios(supportsReasoning);
		console.log(`--- payload sizes (supportsReasoning=${supportsReasoning}) ---`);
		for (const scenario of sample) {
			console.log(`${scenario.name}: payload ${JSON.stringify(scenario.messages).length} chars`);
		}
	}
	console.log(`\nTesting ${models.length} models, ${REPS} reps per scenario:\n`);

	const results = await Promise.all(
		models.map(async (model) => ({
			model,
			stats: await runModel(
				baseUrl,
				apiKey,
				model,
				await buildScenarios(modelPreservesReasoning(model))
			),
		}))
	);

	let regressions = 0;
	let semanticFailures = 0;
	const fmt = (n?: number) => (n === undefined ? "   —" : String(Math.round(n)).padStart(4));
	console.log("\n=== RESULTS (median over reps; ttft ms | ~tok/s | total ms) ===");
	for (const { model, stats } of results) {
		const regressed = Object.entries(FAMILIES).some(([base, dependents]) => {
			const baseStat = stats.find((s) => s.scenario === base);
			if (!baseStat?.ok) return false;
			return dependents.some((name) => {
				const dep = stats.find((s) => s.scenario === name);
				if (!dep?.ok) return true;
				// A dependent scenario that technically succeeded but answered
				// incoherently, when the baseline it's compared against did not,
				// is a real regression: the request was accepted but the replayed
				// history degraded the answer. Only compares against a coherent
				// baseline — an already-incoherent baseline says nothing about
				// whether replay made things worse.
				return baseStat.coherent !== false && dep.coherent === false;
			});
		});
		// Semantic gate: N2-nonce-replay succeeding at the HTTP level is not
		// enough — the nonce must actually appear in the answer, or replay
		// isn't proven to work, only that the provider accepted the shape.
		// nonceOk is independent of overall scenario.ok on purpose: runModel
		// already scopes it to only the reps that succeeded (nonceRuns), so a
		// rep that failed at the HTTP level (timeout, 5xx) must never mask a
		// DIFFERENT rep that succeeded and directly demonstrated the nonce is
		// missing — that observed failure is real signal either way.
		// The scenario must ALSO have succeeded overall: if every rep timed out
		// or errored, nonceRuns is empty and nonceOk is undefined (neither true
		// nor false), which must not read as "no semantic failure" — the sole
		// proof that replay works semantically was never obtained, so treat an
		// unresolved nonce scenario as a failure too, not a silent pass.
		const nonceScenario = stats.find((s) => s.scenario === "N2-nonce-replay");
		const semanticFailure = Boolean(
			nonceScenario && (nonceScenario.nonceOk === false || !nonceScenario.ok)
		);
		if (regressed) regressions += 1;
		if (semanticFailure) semanticFailures += 1;
		console.log(`${regressed || semanticFailure ? "❌" : "✅"} ${model}`);
		for (const s of stats) {
			const partial = !s.ok && s.okCount > 0;
			const nonceFailed = s.nonceOk === false;
			const status = !s.ok
				? `${partial ? `FLAKY(${s.okCount}/${s.repCount})` : "FAIL"}${nonceFailed ? ", no nonce" : ""}`
				: nonceFailed
					? "OK(no nonce)"
					: `OK${s.coherent === false ? "(incoherent)" : ""}`;
			console.log(
				`    ${s.scenario.padEnd(16)} ${status.padEnd(14)} ttft ${fmt(s.ttftMs)} | ${fmt(
					s.tokPerSec
				)} tok/s | total ${fmt(s.totalMs)}${s.ok && !nonceFailed ? "" : `  ${s.note}`}`
			);
		}
	}

	console.log(
		`\n${regressions === 0 && semanticFailures === 0 ? "SHIPPABLE" : "NOT SHIPPABLE"}: ` +
			`${regressions} model(s) shape-regressed, ${semanticFailures} model(s) failed the nonce semantic proof.`
	);
	process.exit(regressions === 0 && semanticFailures === 0 ? 0 : 1);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
