/**
 * Compatibility harness for the reasoning/tool-history replay changes.
 *
 * Sends one synthetic tool-using conversation to the first N router models in
 * three shapes and compares acceptance:
 *   S1 baseline  — flat {role, content} history (current prod behavior)
 *   S2 replay    — output of prepareMessagesWithFiles({replayToolHistory: true})
 *   S3 in-loop   — S2 with reasoning_content on a tool-call assistant message
 *                  and `content` omitted (the shape runMcpFlow now sends
 *                  between tool rounds)
 *
 * Ship criterion: every model that accepts S1 must also accept S2 and S3.
 *
 * Run it the same way as the other repo scripts (see "populate" in package.json),
 * passing this file's path to vite-node.
 */
import { readFileSync } from "fs";
import { prepareMessagesWithFiles } from "$lib/server/textGeneration/utils/prepareFiles";
import type { EndpointMessage } from "$lib/server/endpoints/endpoints";
import type { makeImageProcessor } from "$lib/server/endpoints/images";
import { MessageToolUpdateType, MessageUpdateType } from "$lib/types/MessageUpdate";
import { ToolResultStatus } from "$lib/types/Tool";
import type { OpenAI } from "openai";

const MODEL_COUNT = 10;
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

async function buildScenarios(): Promise<Record<string, ChatMessage[]>> {
	const baseline: ChatMessage[] = [
		{ role: "system", content: SYSTEM },
		...(await prepareMessagesWithFiles(storedHistory, imageProcessor, false)),
	];
	const replay: ChatMessage[] = [
		{ role: "system", content: SYSTEM },
		...(await prepareMessagesWithFiles(storedHistory, imageProcessor, false, {
			replayToolHistory: true,
		})),
	];
	// S3: attach reasoning_content to the first tool-call assistant message,
	// mirroring what runMcpFlow now sends between rounds of a live turn.
	const inloop: ChatMessage[] = replay.map((m) =>
		m.role === "assistant" && "tool_calls" in m && m.tool_calls?.[0]?.id === "call-1"
			? { ...m, reasoning_content: "The user wants current weather, calling get_weather first." }
			: m
	);
	return { "S1-baseline": baseline, "S2-replay": replay, "S3-inloop": inloop };
}

type Verdict = {
	model: string;
	scenario: string;
	ok: boolean;
	ms: number;
	coherent?: boolean;
	note: string;
};

async function runOne(
	baseUrl: string,
	apiKey: string,
	model: string,
	scenario: string,
	messages: ChatMessage[]
): Promise<Verdict> {
	const started = Date.now();
	try {
		const res = await fetch(`${baseUrl}/chat/completions`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
			body: JSON.stringify({
				model,
				messages,
				tools: TOOLS,
				tool_choice: "auto",
				temperature: 0,
				max_tokens: MAX_TOKENS,
				stream: false,
			}),
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		const ms = Date.now() - started;
		if (!res.ok) {
			const body = (await res.text()).slice(0, 300).replace(/\s+/g, " ");
			return { model, scenario, ok: false, ms, note: `HTTP ${res.status}: ${body}` };
		}
		const json = (await res.json()) as {
			choices?: Array<{
				message?: { content?: string | null; tool_calls?: unknown[] };
			}>;
		};
		const msg = json.choices?.[0]?.message;
		const content = (msg?.content ?? "").trim();
		const calledTools = Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0;
		if (!content && !calledTools) {
			return { model, scenario, ok: false, ms, note: "empty response" };
		}
		const coherent = content.length > 0 ? /paris/i.test(content) && /18/.test(content) : undefined;
		return {
			model,
			scenario,
			ok: true,
			ms,
			coherent,
			note: calledTools && !content ? "answered with tool_calls" : content.slice(0, 80),
		};
	} catch (err) {
		return {
			model,
			scenario,
			ok: false,
			ms: Date.now() - started,
			note: err instanceof Error ? `${err.name}: ${err.message.slice(0, 200)}` : String(err),
		};
	}
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
	console.log(`Testing ${models.length} models:\n  ${models.join("\n  ")}\n`);

	const scenarios = await buildScenarios();
	const jobs: Array<Promise<Verdict>> = [];
	for (const model of models) {
		for (const [name, messages] of Object.entries(scenarios)) {
			jobs.push(runOne(baseUrl, apiKey, model, name, messages));
		}
	}
	const verdicts = await Promise.all(jobs);

	const byModel = new Map<string, Verdict[]>();
	for (const v of verdicts) {
		byModel.set(v.model, [...(byModel.get(v.model) ?? []), v]);
	}

	let regressions = 0;
	console.log("\n=== RESULTS ===");
	for (const [model, list] of byModel) {
		const get = (s: string) => list.find((v) => v.scenario === s);
		const s1 = get("S1-baseline");
		const s2 = get("S2-replay");
		const s3 = get("S3-inloop");
		const flag = (v?: Verdict) =>
			v?.ok ? `OK${v.coherent === false ? "(incoherent)" : ""}` : `FAIL`;
		const regressed = Boolean(s1?.ok && (!s2?.ok || !s3?.ok));
		if (regressed) regressions += 1;
		console.log(
			`${regressed ? "❌" : "✅"} ${model}\n` +
				`    S1-baseline: ${flag(s1)} (${s1?.ms}ms) ${s1?.ok ? "" : s1?.note}\n` +
				`    S2-replay:   ${flag(s2)} (${s2?.ms}ms) ${s2?.ok ? "" : s2?.note}\n` +
				`    S3-inloop:   ${flag(s3)} (${s3?.ms}ms) ${s3?.ok ? "" : s3?.note}`
		);
		for (const v of [s1, s2, s3]) {
			if (v?.ok && v.note && !v.note.startsWith("answered")) {
				console.log(`      ${v.scenario} → ${v.note}`);
			}
		}
	}

	console.log(
		`\n${regressions === 0 ? "SHIPPABLE" : "NOT SHIPPABLE"}: ${regressions} model(s) regressed vs baseline.`
	);
	console.log(JSON.stringify(verdicts, null, 1));
	process.exit(regressions === 0 ? 0 : 1);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
