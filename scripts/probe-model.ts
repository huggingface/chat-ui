/**
 * Model/provider probe for the tool-calling flow.
 *
 * Sends the request shape runMcpFlow sends (stream, tools, tool_choice auto,
 * max_tokens) with a generated ML Intern-style history — hf_jobs calls and
 * training-log tool results — scaled to a target prompt size, then records how
 * the SSE stream ends. Because the history is generated from a seed, the
 * `recall` task can be graded byte-for-byte: it asks for the job id and the
 * exact `step=100` log line of specific jobs buried in the context.
 *
 * Verdicts:
 *   OK         finished normally; recall (when asked) mostly correct
 *   DEGRADED   coherent transport but wrong/fabricated recall, or degenerate
 *              output (repetition), or reasoning-only until the cap
 *   SWALLOWED  provider billed far more completion tokens than it delivered,
 *              or a tool task ended with "stop" and no tool call
 *   TRUNCATED  stream ended without [DONE] or without a finish_reason
 *   ERROR      non-200 response or transport failure
 *
 * Usage:
 *   npm run probe-model -- --model zai-org/GLM-5.3-Flash
 *   npm run probe-model -- --model zai-org/GLM-5.3-Flash --provider together
 *   npm run probe-model -- --model moonshotai/Kimi-K3 --size 300000 --task recall
 *   npm run probe-model -- --model zai-org/GLM-5.3 --suite quick
 *
 * Suites (default `standard`): each provider the router lists for the model
 * (or --provider) runs every step. Sizes are prompt tokens; `%` of the
 * provider's whole context window, clamped so prompt plus reply still fits.
 *   quick     tool@100k, recall@300k
 *   standard  tool@100k, recall@300k, recall@75%, recall@90%
 *
 * Results go to --out (default .probe-results/): a results.jsonl, one .json
 * summary and one .sse raw capture per run. Needs OPENAI_API_KEY (an HF token)
 * in the env or .env.local, as the other scripts do.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "fs";
import { join } from "path";
import { Agent, fetch as undiciFetch } from "undici";

type Args = Record<string, string | true>;
const args: Args = {};
{
	const argv = process.argv.slice(2);
	for (let i = 0; i < argv.length; i++) {
		const m = /^--([^=]+)(?:=(.*))?$/.exec(argv[i]);
		if (!m) continue;
		if (m[2] !== undefined) args[m[1]] = m[2];
		else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) args[m[1]] = argv[++i];
		else args[m[1]] = true;
	}
}
const str = (k: string): string | undefined =>
	typeof args[k] === "string" ? String(args[k]) : undefined;

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
const { baseUrl, apiKey } = loadEnv();

const OUT = str("out") ?? ".probe-results";
mkdirSync(OUT, { recursive: true });

// Prefill of a 1M-token prompt can exceed undici's default 5-minute header
// timeout; the probe measures that instead of dying on it.
const agent = new Agent({ headersTimeout: 0, bodyTimeout: 0 });

type OaTool = {
	type: "function";
	function: { name: string; description?: string; parameters?: Record<string, unknown> };
};

// The Hub MCP tool list depends on the account's settings; these three are what
// the ML Intern prompt names, so they are always advertised (the mode's history
// calls them, and a call to an unadvertised name is one of the failure modes
// under test).
const REQUIRED_TOOLS: OaTool[] = [
	{
		type: "function",
		function: {
			name: "hf_jobs",
			description:
				"Remote compute for Hugging Face workflows. Run Python/UV or Docker jobs to analyze Hub datasets, repos, models and large files; run batch inference/evaluation; or perform long-running work. Includes submit, logs, inspect, cancel, schedule, and volume mounting.",
			parameters: {
				type: "object",
				properties: {
					operation: {
						type: "string",
						enum: ["run", "uv", "ps", "logs", "inspect", "cancel"],
						description: "Operation to execute.",
					},
					args: {
						type: "object",
						description: "Operation-specific arguments as a JSON object",
						additionalProperties: {},
					},
				},
			},
		},
	},
	{
		type: "function",
		function: {
			name: "hf_sandbox_exec",
			description:
				"Run a shell command inside a Hugging Face Sandbox. Grammar: exec HANDLE SHELL_COMMAND [--workdir PATH] [--timeout SECONDS] [--detach]. SHELL_COMMAND is one string token and runs via /bin/sh -lc.",
			parameters: {
				type: "object",
				additionalProperties: false,
				properties: {
					cmd: { type: "string", enum: ["exec"] },
					args: { type: "array", items: { type: "string" } },
				},
				required: ["cmd", "args"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "hf_fs_write",
			description:
				"Write or remove files in Hugging Face repositories. Grammar: put URI [--base64] [-m MESSAGE] [--branch BRANCH] [--create-pr]; rm URI [-m MESSAGE]. URI must be an hf://models|datasets|spaces/OWNER/NAME/PATH file URI. Provide file data in the content field.",
			parameters: {
				type: "object",
				properties: {
					cmd: { type: "string", enum: ["put", "rm"] },
					args: { type: "array", items: { type: "string" } },
					content: { type: "string" },
				},
				required: ["cmd", "args"],
			},
		},
	},
];

async function hubTools(): Promise<OaTool[]> {
	const cache = join(OUT, "hub-tools.json");
	if (existsSync(cache)) return JSON.parse(readFileSync(cache, "utf-8"));
	const url = "https://hf.co/mcp?login";
	const headers = {
		"content-type": "application/json",
		accept: "application/json, text/event-stream",
		authorization: `Bearer ${apiKey}`,
	};
	const rpc = async (body: unknown, sid?: string) => {
		const res = await fetch(url, {
			method: "POST",
			headers: { ...headers, ...(sid ? { "mcp-session-id": sid } : {}) },
			body: JSON.stringify(body),
		});
		const text = await res.text();
		let json: {
			result?: {
				tools?: { name: string; description?: string; inputSchema?: Record<string, unknown> }[];
			};
		} = {};
		try {
			const data = (res.headers.get("content-type") ?? "").includes("event-stream")
				? text
						.split("\n")
						.find((l) => l.startsWith("data:"))
						?.slice(5)
				: text;
			if (data) json = JSON.parse(data);
		} catch {
			// a notification response has no body
		}
		return { res, json };
	};
	let listed: OaTool[] = [];
	try {
		const init = await rpc({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: {
				protocolVersion: "2025-03-26",
				capabilities: {},
				clientInfo: { name: "probe-model", version: "0" },
			},
		});
		const sid = init.res.headers.get("mcp-session-id") ?? undefined;
		await rpc({ jsonrpc: "2.0", method: "notifications/initialized" }, sid);
		const list = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, sid);
		listed = (list.json.result?.tools ?? []).map((t) => ({
			type: "function" as const,
			function: { name: t.name, description: t.description, parameters: t.inputSchema },
		}));
	} catch (e) {
		console.warn(`[probe] hub tools/list failed (${String(e)}); using the built-in schemas only`);
	}
	const names = new Set(listed.map((t) => t.function.name));
	const tools = [...REQUIRED_TOOLS.filter((t) => !names.has(t.function.name)), ...listed];
	writeFileSync(cache, JSON.stringify(tools, null, 1));
	return tools;
}

// ---------- generated history ----------

function rng(seed: number) {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 4294967296;
	};
}
const WORDS =
	"loss step epoch lr grad_norm eval accuracy tokens throughput checkpoint saved warmup batch shard dataset tokenizer optimizer adamw cosine schedule fp16 bf16 cuda memory allocated reserved wandb logged samples".split(
		" "
	);

function trainingScript(i: number): string {
	return `import torch, datasets
from transformers import AutoModelForCausalLM, AutoTokenizer, Trainer, TrainingArguments
ds = datasets.load_dataset("probe/ds-${i}", split="train")
tok = AutoTokenizer.from_pretrained("Qwen/Qwen2.5-0.5B")
model = AutoModelForCausalLM.from_pretrained("Qwen/Qwen2.5-0.5B", torch_dtype=torch.bfloat16)
ds = ds.map(lambda ex: tok(ex["text"], truncation=True, max_length=1024), batched=True, remove_columns=ds.column_names)
args = TrainingArguments(output_dir="out-${i}", per_device_train_batch_size=8, learning_rate=${(2e-5 + i * 1e-6).toExponential(2)}, num_train_epochs=1, bf16=True, logging_steps=10, save_steps=500, push_to_hub=True, hub_model_id="probe/run-${i}")
Trainer(model=model, args=args, train_dataset=ds).train()
`;
}

type Msg = Record<string, unknown> & { role: string };

const SYSTEM_PROMPT = [
	"You are ML Intern, an assistant that runs machine-learning work on the Hugging Face Hub on the user's behalf.",
	"You launch training and evaluation as jobs with hf_jobs, inspect their logs, run quick commands in a sandbox with hf_sandbox_exec, and write files to repositories with hf_fs_write.",
	"Every job you launch is recorded in this conversation with its id and logs; refer back to them precisely and never invent ids or log lines.",
	"Ground every claim in the tool results present in the conversation.",
].join("\n");

const CHARS_PER_TOKEN = Number(str("cpt") ?? 2.05);

function buildHistory(targetTokens: number, tools: OaTool[], seed: number) {
	const rand = rng(seed);
	const msgs: Msg[] = [{ role: "system", content: SYSTEM_PROMPT }];
	let chars = SYSTEM_PROMPT.length + JSON.stringify(tools).length;
	const budget = targetTokens * CHARS_PER_TOKEN;
	let i = 0;
	while (chars < budget) {
		i += 1;
		const callId = `call_${i}_${Math.floor(rand() * 1e9).toString(36)}`;
		const jobId = Math.floor(rand() * 1e12).toString(16);
		const nlines = 40 + Math.floor(rand() * 80);
		const lines: string[] = [];
		for (let k = 0; k < nlines; k++) {
			const step = k * 10;
			const loss = (2.9 * Math.exp(-step / (400 + i * 37)) + rand() * 0.08).toFixed(4);
			const w = WORDS[Math.floor(rand() * WORDS.length)];
			lines.push(
				`[${new Date(1756800000000 + i * 3600000 + k * 1500).toISOString()}] step=${step} loss=${loss} lr=${(2e-5 * (1 - step / 4000)).toExponential(3)} grad_norm=${(rand() * 3).toFixed(3)} tok/s=${Math.floor(9000 + rand() * 4000)} ${w}=${(rand() * 100).toFixed(2)}`
			);
		}
		const round: Msg[] = [
			{
				role: "user",
				content:
					i === 1
						? "Fine-tune Qwen2.5-0.5B on probe/ds-1 and report the loss curve."
						: `Now do the same for probe/ds-${i}, but with lr ${(2e-5 + i * 1e-6).toExponential(2)}.`,
			},
			{
				role: "assistant",
				content: `Launching job ${i} on an a10g-small.`,
				tool_calls: [
					{
						id: callId,
						type: "function",
						function: {
							name: "hf_jobs",
							arguments: JSON.stringify({
								operation: "uv",
								args: {
									flavor: "a10g-small",
									timeout: "2h",
									script: trainingScript(i),
									secrets: ["HF_TOKEN"],
								},
							}),
						},
					},
				],
			},
			{
				role: "tool",
				tool_call_id: callId,
				content: `Job ${jobId} launched. Status: COMPLETED\n--- logs ---\n${lines.join("\n")}\n--- end ---`,
			},
			{
				role: "assistant",
				content: `Job ${i} (id \`${jobId}\`) finished. Final loss ${(0.3 + rand() * 0.2).toFixed(4)} after ${nlines * 10} steps; throughput ~${Math.floor(9000 + rand() * 4000)} tok/s. Model pushed to probe/run-${i}.`,
			},
		];
		for (const m of round) {
			msgs.push(m);
			chars += JSON.stringify(m).length;
		}
	}
	return { msgs, rounds: i };
}

const RECALL_JOBS = [5, 100, 148, 149, 180, 214];

const TASKS: Record<string, string> = {
	answer:
		"Write a detailed retrospective (at least 1500 words) of everything we did in this session: one section per job with the job id, learning rate, final loss, and what changed from the previous run, then a markdown table of all jobs, then recommendations for the next 5 experiments.",
	tool: "Now launch one more job on probe/ds-next with lr 3e-5 using hf_jobs. Write the full training script inline in the tool call like before.",
	bigtool:
		"Now launch one more job on probe/ds-next with hf_jobs. The script must be a complete, self-contained training script of at least 300 lines: a custom data collator, a cosine scheduler with warmup, periodic evaluation, checkpoint resumption, W&B logging, and extensive docstrings. Put the whole script inline in the tool call arguments.",
	dump: "Produce a complete audit document. First a markdown table of EVERY job in this session (id, dataset, learning rate, final loss, steps, throughput). Then, for EVERY job in order, a section with its id and the first 12 log lines reproduced verbatim in a code block. Do not skip or summarize any job; this document must be exhaustive even if it is very long.",
	recall: `Answer ONLY with a JSON object, no prose. For each of jobs ${RECALL_JOBS.join(", ")} (the Nth job we launched in this session): give the job id (the hex id from the tool result) and reproduce VERBATIM the log line containing step=100 from that job's logs as they appear in the tool result. Format: {"5": {"id": "...", "step100": "..."}, ...}. If a job's logs are genuinely not present in the context, use "NOT_PRESENT" for that field.`,
};

// ---------- one run ----------

interface RunSpec {
	model: string;
	provider?: string;
	size: number;
	task: string;
	maxTokens: number;
	label: string;
}

interface RunResult extends RunSpec {
	modelId: string;
	status?: number;
	providerHeader?: string | null;
	ttfbMs?: number;
	totalMs?: number;
	chunks: number;
	maxGapMs: number;
	contentChars: number;
	reasoningChars: number;
	toolCalls: { name: string; argChars: number; valid: boolean }[];
	finishReasons: string[];
	sawDone: boolean;
	errors: string[];
	streamError?: string;
	errorBody?: string;
	usage?: {
		prompt_tokens?: number;
		completion_tokens?: number;
		prompt_tokens_details?: { cached_tokens?: number };
	};
	recall?: { score: number; total: number; detail: string[] };
	verdict: string;
	reason: string;
	contentTail: string;
}

function gradeRecall(content: string, history: Msg[]) {
	const tools = history.filter((m) => m.role === "tool");
	const present = RECALL_JOBS.filter((n) => tools[n - 1]);
	let answer: Record<string, { id?: string; step100?: string }> = {};
	try {
		answer = JSON.parse(/\{[\s\S]*\}/.exec(content)?.[0] ?? "{}");
	} catch {
		// unparseable answers score zero
	}
	let score = 0;
	const detail = present.map((n) => {
		const text = String(tools[n - 1].content);
		const id = /Job ([0-9a-f]+) launched/.exec(text)?.[1];
		const line = text.split("\n").find((l) => / step=100 /.test(l));
		const a = answer[String(n)] ?? {};
		const good = a.id === id && a.step100 === line;
		if (good) score++;
		return `${n}:${good ? "ok" : a.step100 === "NOT_PRESENT" ? "not-present" : "wrong"}`;
	});
	return { score, total: present.length, detail };
}

function uniqueWordRatio(text: string): number {
	const words = text.split(/\s+/).filter(Boolean);
	if (words.length < 50) return 1;
	return new Set(words).size / words.length;
}

async function runOne(spec: RunSpec, tools: OaTool[]): Promise<RunResult> {
	const { msgs, rounds } = buildHistory(spec.size, tools, 42);
	msgs.push({ role: "user", content: TASKS[spec.task] });
	const modelId = spec.provider ? `${spec.model}:${spec.provider}` : spec.model;
	const body = {
		model: modelId,
		stream: true,
		messages: msgs,
		tools,
		tool_choice: "auto",
		max_tokens: spec.maxTokens,
		stream_options: { include_usage: true },
	};
	const result: RunResult = {
		...spec,
		modelId,
		chunks: 0,
		maxGapMs: 0,
		contentChars: 0,
		reasoningChars: 0,
		toolCalls: [],
		finishReasons: [],
		sawDone: false,
		errors: [],
		verdict: "ERROR",
		reason: "",
		contentTail: "",
	};
	void rounds;
	const raw: string[] = [];
	const t0 = Date.now();
	let res: Awaited<ReturnType<typeof undiciFetch>>;
	try {
		res = await undiciFetch(`${baseUrl}/chat/completions`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${apiKey}`,
				"X-use-cache": "false",
			},
			body: JSON.stringify(body),
			dispatcher: agent,
		});
	} catch (e) {
		result.streamError = String(e);
		result.reason = "fetch failed";
		return result;
	}
	result.status = res.status;
	result.providerHeader = res.headers.get("x-inference-provider");
	result.ttfbMs = Date.now() - t0;
	if (!res.ok || !res.body) {
		result.errorBody = (await res.text()).slice(0, 2000);
		result.reason = `HTTP ${res.status}`;
		return result;
	}

	let content = "";
	let reasoning = "";
	const calls: Record<number, { name: string; args: string }> = {};
	let buf = "";
	let lastAt = Date.now();
	const dec = new TextDecoder();
	try {
		for await (const piece of res.body as AsyncIterable<Uint8Array>) {
			const now = Date.now();
			result.maxGapMs = Math.max(result.maxGapMs, now - lastAt);
			lastAt = now;
			const text = dec.decode(piece, { stream: true });
			raw.push(text);
			buf += text;
			let idx: number;
			while ((idx = buf.indexOf("\n\n")) !== -1) {
				const evt = buf.slice(0, idx);
				buf = buf.slice(idx + 2);
				for (const line of evt.split("\n")) {
					if (!line.startsWith("data:")) continue;
					const data = line.slice(5).trim();
					if (data === "[DONE]") {
						result.sawDone = true;
						continue;
					}
					let j: Record<string, unknown>;
					try {
						j = JSON.parse(data);
					} catch {
						continue;
					}
					result.chunks++;
					if (j.error) result.errors.push(JSON.stringify(j.error).slice(0, 500));
					if (j.usage) result.usage = j.usage as RunResult["usage"];
					const choice = (
						j.choices as { finish_reason?: string; delta?: Record<string, unknown> }[] | undefined
					)?.[0];
					if (!choice) continue;
					if (choice.finish_reason) result.finishReasons.push(choice.finish_reason);
					const d = choice.delta ?? {};
					if (typeof d.content === "string") content += d.content;
					const r = d.reasoning_content ?? d.reasoning ?? d.reasoning_text;
					if (typeof r === "string") reasoning += r;
					for (const tc of (d.tool_calls as {
						index?: number;
						function?: { name?: string; arguments?: string };
					}[]) ?? []) {
						const cur = (calls[tc.index ?? 0] ??= { name: "", args: "" });
						if (tc.function?.name) cur.name = tc.function.name;
						if (tc.function?.arguments) cur.args += tc.function.arguments;
					}
				}
			}
		}
	} catch (e) {
		result.streamError = String(e);
	}
	result.totalMs = Date.now() - t0;
	result.contentChars = content.length;
	result.reasoningChars = reasoning.length;
	result.contentTail = content.slice(-300);
	result.toolCalls = Object.values(calls).map((c) => {
		let valid = true;
		try {
			JSON.parse(c.args);
		} catch {
			valid = false;
		}
		return { name: c.name, argChars: c.args.length, valid };
	});
	if (spec.task === "recall") result.recall = gradeRecall(content, msgs);
	writeFileSync(join(OUT, `${spec.label}.sse`), raw.join(""));

	// ---- verdict ----
	const finish = result.finishReasons.at(-1);
	const deliveredTokens =
		(content.length +
			reasoning.length +
			Object.values(calls).reduce((n, c) => n + c.args.length, 0)) /
		3;
	const billed = result.usage?.completion_tokens ?? 0;
	if (result.streamError) {
		result.verdict = "ERROR";
		result.reason = result.streamError;
	} else if (result.errors.length) {
		result.verdict = "ERROR";
		result.reason = result.errors[0];
	} else if (!result.sawDone || !finish) {
		result.verdict = "TRUNCATED";
		result.reason = !result.sawDone ? "stream ended without [DONE]" : "no finish_reason";
	} else if (
		["tool", "bigtool"].includes(spec.task) &&
		finish === "stop" &&
		result.toolCalls.length === 0
	) {
		result.verdict = "SWALLOWED";
		result.reason = `tool task ended with "stop" and no tool call (${billed} tokens billed)`;
	} else if (billed > 200 && billed > deliveredTokens * 2 + 100) {
		result.verdict = "SWALLOWED";
		result.reason = `billed ${billed} completion tokens, delivered ~${Math.round(deliveredTokens)}`;
	} else if (result.toolCalls.some((c) => !c.valid) && finish !== "length") {
		result.verdict = "DEGRADED";
		result.reason = "tool call arguments are not valid JSON";
	} else if (uniqueWordRatio(content) < 0.3) {
		result.verdict = "DEGRADED";
		result.reason = "degenerate repetition in output";
	} else if (spec.task === "recall" && result.recall && content.trim().length === 0) {
		result.verdict = "DEGRADED";
		result.reason =
			finish === "length" ? "reasoning-only until the output cap; no answer" : "no visible answer";
	} else if (
		spec.task === "recall" &&
		result.recall &&
		result.recall.score * 2 < result.recall.total
	) {
		result.verdict = "DEGRADED";
		result.reason = `recall ${result.recall.score}/${result.recall.total} [${result.recall.detail.join(" ")}]`;
	} else {
		result.verdict = "OK";
		result.reason =
			spec.task === "recall" && result.recall
				? `recall ${result.recall.score}/${result.recall.total}`
				: result.toolCalls.length
					? `tool call ${result.toolCalls.map((c) => `${c.name}(${c.argChars} chars)`).join(", ")}`
					: `finish=${finish}, ${content.length} chars`;
	}
	return result;
}

// ---------- suites ----------

async function providersFor(
	model: string
): Promise<{ provider: string; context_length?: number }[]> {
	const res = await fetch(`${baseUrl}/models`);
	const json = (await res.json()) as {
		data: {
			id: string;
			providers?: { provider: string; context_length?: number; status?: string }[];
		}[];
	};
	const entry = json.data.find((m) => m.id === model);
	if (!entry) throw new Error(`model ${model} not in ${baseUrl}/models`);
	return (entry.providers ?? []).filter((p) => p.status !== "error");
}

const SUITES: Record<string, { task: string; size: string }[]> = {
	quick: [
		{ task: "tool", size: "100000" },
		{ task: "recall", size: "300000" },
	],
	standard: [
		{ task: "tool", size: "100000" },
		{ task: "recall", size: "300000" },
		{ task: "recall", size: "75%" },
		{ task: "recall", size: "90%" },
	],
};

function resolveSize(
	size: string,
	contextLength: number | undefined,
	maxTokens: number
): number | undefined {
	if (size.endsWith("%")) {
		const window = contextLength ?? 131072;
		const pct = Number(size.slice(0, -1)) / 100;
		// Of the whole window, clamped only so prompt plus reply still fits.
		return Math.min(Math.floor(window * pct), window - maxTokens);
	}
	const n = Number(size);
	if (contextLength && n > contextLength - maxTokens) return undefined;
	return n;
}

function line(r: RunResult): string {
	const prompt = r.usage?.prompt_tokens?.toLocaleString("en-US") ?? "-";
	return [
		r.verdict.padEnd(9),
		r.modelId.padEnd(44),
		`${r.task}@${prompt}`.padEnd(20),
		`finish=${r.finishReasons.at(-1) ?? "-"}`.padEnd(18),
		`ttfb=${r.ttfbMs ?? "-"}ms gap=${r.maxGapMs}ms`.padEnd(28),
		r.reason,
	].join(" ");
}

async function main() {
	const model = str("model");
	if (!model) {
		console.error(
			"usage: npm run probe-model -- --model <id> [--provider p] [--suite quick|standard] [--size N|N%] [--task recall|tool|answer|bigtool|dump] [--max-tokens N] [--out dir]"
		);
		process.exit(1);
	}
	const maxTokens = Number(str("max-tokens") ?? 32768);
	const tools = await hubTools();
	const listed = await providersFor(model);
	const providers = str("provider")
		? [
				{
					provider: String(str("provider")),
					context_length: listed.find((p) => p.provider === str("provider"))?.context_length,
				},
			]
		: listed;
	const steps =
		str("size") || str("task")
			? [{ task: str("task") ?? "recall", size: str("size") ?? "300000" }]
			: SUITES[str("suite") ?? "standard"];
	if (!steps) throw new Error(`unknown suite ${str("suite")}`);

	console.log(
		`model ${model}; providers ${providers.map((p) => p.provider).join(", ")}; ${tools.length} tools; out ${OUT}`
	);
	const results: RunResult[] = [];
	for (const p of providers) {
		for (const step of steps) {
			const size = resolveSize(step.size, p.context_length, maxTokens);
			if (size === undefined) {
				console.log(
					`SKIP      ${model}:${p.provider} ${step.task}@${step.size} exceeds the provider window`
				);
				continue;
			}
			const label = `${model.replace("/", "_")}__${p.provider}__${step.task}@${size}`;
			const spec: RunSpec = {
				model,
				provider: p.provider,
				size,
				task: step.task,
				maxTokens,
				label,
			};
			const r = await runOne(spec, tools);
			results.push(r);
			appendFileSync(join(OUT, "results.jsonl"), JSON.stringify(r) + "\n");
			writeFileSync(join(OUT, `${label}.json`), JSON.stringify(r, null, 2));
			console.log(line(r));
		}
	}
	const bad = results.filter((r) => r.verdict !== "OK");
	console.log(`\n${results.length} runs, ${bad.length} not OK`);
	process.exit(bad.length ? 2 : 0);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
