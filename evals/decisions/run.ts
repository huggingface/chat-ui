/**
 * One arm of a decision eval: rebuilds the request production sent at each case's cut, with this
 * checkout's prompt and tools, and samples the model's next step N times.
 *
 * Run: npm run eval:run -- --cases <dir> --out <run dir> [--model zai-org/GLM-5.3-Flash]
 *   [--provider novita] [--per-family 20] [--samples 10] [--families a,b] [--seed decisions-v1]
 *   [--budget-usd 25] [--concurrency 8] [--dump-requests] [--require-hub-tools]
 * Run it once per arm, from each arm's checkout, with the same arguments, then compare the run
 * dirs with eval:compare. Resumes: samples already in <run dir>/samples.jsonl are kept.
 * --dump-requests writes each case's request to <run dir>/requests/, to diff what two arms sent.
 * --require-hub-tools stops before sampling when the token cannot see every tool production offers.
 *
 * The app reads its config once, at import, so this re-runs itself with production's settings
 * from chart/env/prod.yaml in the environment before loading any of it.
 */
import { execSync, spawn } from "node:child_process";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { indexCases, readCaseAt } from "./caseFile";
import { contextFor } from "./calls";
import { billingHeaders, hfToken } from "./judge";
import { label, LABELS } from "./labels";
import { readReferences, selectCases } from "./select";
import type { Action, Family } from "./types";

/** chart values that only make sense in the cluster, or would point the app at production's data */
const SKIPPED_PROD_ENV =
	/^(MONGODB_|APP_BASE$|PUBLIC_ORIGIN$|COOKIE_|OPENID_|ADDRESS_HEADER$|METRICS_|LLM_ROUTER_ROUTES_PATH$|USE_USER_TOKEN$|AUTOMATIC_LOGIN$)/;
const ATTEMPTS = 3;
/** the intern bouquet as production's token sees it; keep in step with hf-mcp-server */
const INTERN_HUB_TOOLS = [
	"hf_whoami",
	"create_repo",
	"hub_repo_details",
	"hf_fs",
	"hf_fs_write",
	"hf_jobs",
	"hf_sandbox",
	"hf_sandbox_exec",
	"hf_sandbox_fs",
];

function arg(flag: string, fallback?: string): string {
	const at = process.argv.indexOf(flag);
	const value = at === -1 ? fallback : process.argv[at + 1];
	if (value === undefined) throw new Error(`missing ${flag}`);
	return value;
}

function prodEnv(): Record<string, string> {
	const chart = yaml.load(readFileSync("chart/env/prod.yaml", "utf8")) as {
		envVars: Record<string, string>;
	};
	return Object.fromEntries(
		Object.entries(chart.envVars).filter(([key]) => !SKIPPED_PROD_ENV.test(key))
	);
}

/** re-runs this script with production's settings, returning false in the parent */
async function inProdEnv(): Promise<boolean> {
	if (process.env.EVAL_PROD_ENV === "1") return true;
	const token = hfToken();
	const storage = mkdtempSync(join(tmpdir(), "decision-eval-db-"));
	// inside vite-node argv is [node, vite-node, ...args]: the script and its options are gone
	const [, viteNode, ...args] = process.argv;
	const self = fileURLToPath(import.meta.url);
	const options = ["--mode", "test", "--options.transformMode.ssr=/.*/"];
	const child = spawn(process.execPath, [viteNode, ...options, self, "--", ...args], {
		stdio: "inherit",
		env: {
			...process.env,
			...prodEnv(),
			EVAL_PROD_ENV: "1",
			ML_ASSISTANT_MODE: "true",
			OPENAI_API_KEY: token,
			// the app connects at import, so it gets its throwaway in-memory database, never prod's
			MONGODB_URL: "",
			MONGO_STORAGE_PATH: storage,
		},
	});
	const code = await new Promise<number>((resolve) => child.on("exit", (c) => resolve(c ?? 1)));
	// a failed run can exit while mongod is still writing its files
	rmSync(storage, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
	process.exit(code);
}

interface Sample {
	caseId: string;
	family: Family;
	conversationId: string;
	sample: number;
	requestHash: string;
	promptHash: string;
	action?: Action;
	/** labels.ts on the sampled step */
	rules?: { label: string; pass: boolean | null };
	finishReason?: string;
	provider?: string;
	usage?: { prompt_tokens?: number; completion_tokens?: number };
	ms: number;
	error?: string;
}

interface Delta {
	content?: string;
	reasoning_content?: string;
	reasoning?: string;
	tool_calls?: Array<{ index: number; function?: { name?: string; arguments?: string } }>;
}

/** one streamed completion, read the way the turn loop reads it, down to the step it decided */
async function sampleOnce(baseUrl: string, request: object, token: string) {
	const res = await fetch(`${baseUrl}/chat/completions`, {
		method: "POST",
		headers: { ...billingHeaders(token), "content-type": "application/json" },
		body: JSON.stringify({ ...request, stream_options: { include_usage: true } }),
	});
	if (!res.ok || !res.body) throw new Error(`${res.status} ${await res.text()}`);
	let content = "";
	let reasoning = "";
	let finishReason: string | undefined;
	let usage: Sample["usage"];
	const calls: Array<{ name: string; arguments: string }> = [];
	const decoder = new TextDecoder();
	let buffer = "";
	const reader = res.body.getReader();
	for (let read = await reader.read(); !read.done; read = await reader.read()) {
		buffer += decoder.decode(read.value, { stream: true });
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";
		for (const line of lines) {
			if (!line.startsWith("data:")) continue;
			const data = line.slice(5).trim();
			if (!data || data === "[DONE]") continue;
			const event = JSON.parse(data) as {
				choices?: Array<{ delta?: Delta; finish_reason?: string | null }>;
				usage?: Sample["usage"];
			};
			if (event.usage) usage = event.usage;
			const choice = event.choices?.[0];
			if (!choice) continue;
			if (choice.finish_reason) finishReason = choice.finish_reason;
			const delta = choice.delta ?? {};
			content += delta.content ?? "";
			reasoning += delta.reasoning_content ?? delta.reasoning ?? "";
			for (const call of delta.tool_calls ?? []) {
				calls[call.index] ??= { name: "", arguments: "" };
				calls[call.index].name += call.function?.name ?? "";
				calls[call.index].arguments += call.function?.arguments ?? "";
			}
		}
	}
	const action: Action = calls.length
		? {
				kind: "calls",
				calls: calls.filter(Boolean).map((call) => {
					let args: Record<string, unknown>;
					try {
						args = JSON.parse(call.arguments || "{}");
					} catch {
						args = { unparsed: call.arguments };
					}
					return { name: call.name, args };
				}),
				reasoning: reasoning || undefined,
				preamble: content || undefined,
			}
		: { kind: "final", text: content };
	return {
		action,
		finishReason,
		usage,
		provider: res.headers.get("x-inference-provider") ?? undefined,
	};
}

function git(command: string): string {
	try {
		return execSync(`git ${command}`, { encoding: "utf8" }).trim();
	} catch {
		return "";
	}
}

async function main() {
	if (!(await inProdEnv())) return;
	const casesDir = arg("--cases");
	const out = arg("--out");
	const model = arg("--model", "zai-org/GLM-5.3-Flash");
	const provider = arg("--provider", "novita");
	const perFamily = Number(arg("--per-family", "20"));
	const samples = Number(arg("--samples", "10"));
	const seed = arg("--seed", "decisions-v1");
	const budgetUsd = Number(arg("--budget-usd", "25"));
	const concurrency = Number(arg("--concurrency", "8"));
	const families = arg("--families", Object.keys(LABELS).join(",")).split(",") as Family[];
	const dumpRequests = process.argv.includes("--dump-requests");
	const token = hfToken();

	const { requestBuilder } = await import("./request");
	const builder = await requestBuilder({ model, provider, budgetUsd }, token);
	if (process.argv.includes("--require-hub-tools")) {
		const missing = INTERN_HUB_TOOLS.filter((name) => !builder.tools.includes(name));
		if (missing.length)
			throw new Error(
				`the token sees no ${missing.join(", ")}: the Hub MCP server only lists what a token may use, ` +
					"so these requests would not be production's (evals/decisions/README.md lists its permissions)"
			);
	}
	const selected = selectCases(readReferences(casesDir), { families, perFamily, seed });
	console.error(`${selected.length} cases × ${samples} samples, ${model}:${provider}`);

	mkdirSync(out, { recursive: true });
	const meta = {
		startedAt: new Date().toISOString(),
		git: {
			sha: git("rev-parse HEAD"),
			branch: git("rev-parse --abbrev-ref HEAD"),
			dirty: git("status --porcelain") !== "",
		},
		model,
		provider,
		samples,
		perFamily,
		seed,
		budgetUsd,
		families,
		cases: selected.map((r) => r.id),
		mcpTools: builder.tools,
		flags: builder.flags,
	};
	writeFileSync(join(out, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);

	const samplesPath = join(out, "samples.jsonl");
	const done = new Set(
		existsSync(samplesPath)
			? readFileSync(samplesPath, "utf8")
					.split("\n")
					.filter(Boolean)
					.map((line) => JSON.parse(line) as Sample)
					.filter((s) => !s.error)
					.map((s) => `${s.caseId}#${s.sample}`)
			: []
	);

	const rows = new Map(families.map((f) => [f, indexCases(casesDir, f)]));
	const jobs = selected.flatMap((ref) =>
		Array.from({ length: samples }, (_, sample) => ({ ref, sample })).filter(
			({ ref, sample }) => !done.has(`${ref.id}#${sample}`)
		)
	);
	let next = 0;
	let finished = 0;
	let failed = 0;
	const built = new Map<string, ReturnType<typeof builder.build>>();
	await Promise.all(
		Array.from({ length: concurrency }, async () => {
			while (next < jobs.length) {
				const { ref, sample } = jobs[next++];
				const row = rows.get(ref.family)?.find((r) => r.head.id === ref.id);
				if (!row) throw new Error(`case ${ref.id} is not in ${casesDir}`);
				const c = readCaseAt(casesDir, ref.family, row);
				if (!built.has(c.id)) {
					const pending = builder.build(c);
					built.set(c.id, pending);
					if (dumpRequests) {
						const { request } = await pending;
						mkdirSync(join(out, "requests"), { recursive: true });
						writeFileSync(
							join(out, "requests", `${c.id.replaceAll("/", "__")}.json`),
							JSON.stringify(request, null, 1)
						);
					}
				}
				const { request, requestHash, promptHash } = await (built.get(c.id) as ReturnType<
					typeof builder.build
				>);
				const started = Date.now();
				const base = {
					caseId: c.id,
					family: c.family,
					conversationId: c.source.conversationId,
					sample,
					requestHash,
					promptHash,
				};
				let record: Sample | undefined;
				for (let attempt = 1; attempt <= ATTEMPTS && !record; attempt++) {
					try {
						const result = await sampleOnce(builder.baseUrl, request, token);
						record = {
							...base,
							...result,
							rules: label(c.family, result.action, contextFor(c, result.action)),
							ms: Date.now() - started,
						};
					} catch (error) {
						if (attempt === ATTEMPTS) {
							failed += 1;
							record = {
								...base,
								ms: Date.now() - started,
								error: error instanceof Error ? error.message.slice(0, 500) : String(error),
							};
						} else await new Promise((r) => setTimeout(r, 2000 * attempt));
					}
				}
				appendFileSync(samplesPath, `${JSON.stringify(record)}\n`);
				finished += 1;
				if (finished % 10 === 0 || finished === jobs.length)
					console.error(`${finished}/${jobs.length} (${failed} failed)`);
			}
		})
	);
	console.error(`done: ${finished} samples, ${failed} failed → ${samplesPath}`);
	// the app's database and MCP clients keep the process alive
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
