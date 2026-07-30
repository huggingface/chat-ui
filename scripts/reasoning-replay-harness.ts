/**
 * Compatibility + speed harness for the reasoning/tool-history replay changes.
 *
 * Sends one synthetic tool-using conversation to the first N router models in
 * three shapes and compares acceptance and streaming speed:
 *   S1 baseline  — flat {role, content} history (previous prod behavior)
 *   S2 replay    — output of prepareMessagesWithFiles({replayToolHistory: true})
 *   S3 in-loop   — S2 with reasoning_content on a tool-call assistant message
 *                  and `content` omitted (the shape runMcpFlow sends between
 *                  tool rounds)
 *
 * Requests stream (like prod) and are repeated REPS times sequentially per
 * model/scenario, models in parallel, measuring time-to-first-token and
 * generation throughput (approximated from SSE delta chunks).
 *
 * Ship criterion: every model that accepts S1 must also accept S2 and S3.
 *
 * Run it the same way as the other repo scripts (see "populate" in
 * package.json), passing this file's path to vite-node.
 */
import { readFileSync } from "fs";
import { prepareMessagesWithFiles } from "$lib/server/textGeneration/utils/prepareFiles";
import type { EndpointMessage } from "$lib/server/endpoints/endpoints";
import type { makeImageProcessor } from "$lib/server/endpoints/images";
import { MessageToolUpdateType, MessageUpdateType } from "$lib/types/MessageUpdate";
import { ToolResultStatus } from "$lib/types/Tool";
import type { OpenAI } from "openai";

const MODEL_COUNT = 10;
const REPS = 2;
const REQUEST_TIMEOUT_MS = 90_000;
const MAX_TOKENS = 120;

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

type Scenario = {
	name: string;
	messages: ChatMessage[];
	withTools: boolean;
	expect: RegExp[];
};

/** Baseline scenario name → scenarios that must not regress against it. */
const FAMILIES: Record<string, string[]> = {
	"S1-baseline": ["S2-replay", "S3-inloop"],
	"P1-plain": ["P2-reasoning"],
};

async function buildScenarios(): Promise<Scenario[]> {
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
		})
	);
	// S3: attach reasoning_content to the first tool-call assistant message,
	// mirroring what runMcpFlow sends between rounds of a live turn.
	const inloop: ChatMessage[] = replay.map((m) =>
		m.role === "assistant" && "tool_calls" in m && m.tool_calls?.[0]?.id === "call10000"
			? { ...m, reasoning_content: "The user wants current weather, calling get_weather first." }
			: m
	);
	const plain = withSystem(
		await prepareMessagesWithFiles(storedPlainHistory, imageProcessor, false)
	);
	const plainReasoning = withSystem(
		await prepareMessagesWithFiles(storedPlainHistory, imageProcessor, false, {
			attachReasoning: true,
		})
	);

	return [
		{ name: "S1-baseline", messages: baseline, withTools: true, expect: toolExpect },
		{ name: "S2-replay", messages: replay, withTools: true, expect: toolExpect },
		{ name: "S3-inloop", messages: inloop, withTools: true, expect: toolExpect },
		{ name: "P1-plain", messages: plain, withTools: false, expect: plainExpect },
		{ name: "P2-reasoning", messages: plainReasoning, withTools: false, expect: plainExpect },
	];
}

type RunResult = {
	ok: boolean;
	ttftMs?: number;
	totalMs: number;
	genTokens: number;
	coherent?: boolean;
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
					(typeof delta.reasoning_content === "string" ? delta.reasoning_content : "");
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
		const coherent =
			content.length > 0 ? scenario.expect.every((re) => re.test(content)) : undefined;
		return {
			ok: true,
			ttftMs,
			totalMs,
			genTokens,
			coherent,
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
	coherent?: boolean;
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
		stats.push({
			scenario: scenario.name,
			ok: okRuns.length > 0,
			coherent: okRuns.find((r) => r.coherent !== undefined)?.coherent,
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
	const models = (modelsJson.data ?? []).slice(0, MODEL_COUNT).map((m) => m.id);

	const scenarios = await buildScenarios();
	for (const scenario of scenarios) {
		console.log(`${scenario.name}: payload ${JSON.stringify(scenario.messages).length} chars`);
	}
	console.log(`Testing ${models.length} models, ${REPS} reps per scenario:\n`);

	const results = await Promise.all(
		models.map(async (model) => ({
			model,
			stats: await runModel(baseUrl, apiKey, model, scenarios),
		}))
	);

	let regressions = 0;
	const fmt = (n?: number) => (n === undefined ? "   —" : String(Math.round(n)).padStart(4));
	console.log("\n=== RESULTS (median over reps; ttft ms | ~tok/s | total ms) ===");
	for (const { model, stats } of results) {
		const regressed = Object.entries(FAMILIES).some(([base, dependents]) => {
			const baseStat = stats.find((s) => s.scenario === base);
			return Boolean(
				baseStat?.ok && dependents.some((name) => !stats.find((s) => s.scenario === name)?.ok)
			);
		});
		if (regressed) regressions += 1;
		console.log(`${regressed ? "❌" : "✅"} ${model}`);
		for (const s of stats) {
			const status = s.ok ? `OK${s.coherent === false ? "(incoherent)" : ""}` : "FAIL";
			console.log(
				`    ${s.scenario.padEnd(12)} ${status.padEnd(5)} ttft ${fmt(s.ttftMs)} | ${fmt(
					s.tokPerSec
				)} tok/s | total ${fmt(s.totalMs)}${s.ok ? "" : `  ${s.note}`}`
			);
		}
	}

	console.log(
		`\n${regressions === 0 ? "SHIPPABLE" : "NOT SHIPPABLE"}: ${regressions} model(s) regressed vs baseline.`
	);
	process.exit(regressions === 0 ? 0 : 1);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
