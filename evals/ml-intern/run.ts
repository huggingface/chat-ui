/**
 * ml intern outcome eval, see README.md
 *
 * env
 *   HF_TOKEN               required, its account pays for the jobs
 *   OPENAI_API_KEY         inference key for OPENAI_BASE_URL, defaults to HF_TOKEN
 *   OPENAI_BASE_URL        defaults to the hf router
 *   ML_EVAL_SCENARIO       comma separated task names, default all
 *   ML_EVAL_REPEATS        runs per task, default 1
 *   ML_EVAL_OUT            output directory, default eval-output/ml-intern/<timestamp>
 *   ML_EVAL_PORT           app port, default 5210, so two arms can run side by side
 *   ML_EVAL_SKIP_BUILD     1 reuses ./build, which must be built with ML_ASSISTANT_MODE true
 *   ML_EVAL_BUILD_ONLY     1 builds the app with the eval env and exits
 *   ML_EVAL_TRACES_SPACE   trackio space for the traces, a bare name goes under the token user
 *   ML_EVAL_RUN_NAME       trackio run name, defaults to a timestamp
 *
 * a failed check is a result, it exits 0 once result.json is written
 */
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, createWriteStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
import yaml from "js-yaml";
import { BSON, MongoClient, ObjectId } from "mongodb";
import superjson from "superjson";
import {
	artifactReady,
	artifactRepo,
	askedFirst,
	fill,
	parseHiddenResult,
	runNames,
	type RepoInfo,
	type RunNames,
} from "./outcome.ts";
import {
	SCENARIOS,
	type ArtifactKind,
	type Check,
	type ConversationMetrics,
	type HiddenResult,
	type Scenario,
	type ScenarioOutcome,
} from "./scenarios.ts";

const execFileAsync = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

const HF_TOKEN = process.env.HF_TOKEN ?? "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || HF_TOKEN;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "https://router.huggingface.co/v1";
const PORT = Number(process.env.ML_EVAL_PORT ?? 5210);
// An IP literal, not localhost: the app's SSRF guard blocks `localhost`.
const APP_URL = `http://127.0.0.1:${PORT}`;
const COOKIE_NAME = "hf-chat";
const DB_NAME = "chat-ui-ml-eval";
const HUB = "https://huggingface.co";
const ARTIFACT_POLL_MS = 60_000;
/** cluster auth and database settings the eval sets itself */
const SKIPPED_PROD_ENV =
	/^(MONGODB_|APP_BASE$|PUBLIC_ORIGIN$|COOKIE_|OPENID_|ADDRESS_HEADER$|METRICS_|LLM_ROUTER_|USE_USER_TOKEN$|AUTOMATIC_LOGIN$|COUPLE_SESSION_WITH_COOKIE_NAME$|SLACK_|ML_ASSISTANT_MODELS$|MCP_SERVERS$)/;

// ── Types for what the app streams (subset of src/lib/types/MessageUpdate.ts) ──

interface SelectOption {
	value: string;
	label: string;
	description?: string;
	setBudgetUsd?: number;
}
type ElicitationField =
	| { kind: "string"; name: string; title?: string; description?: string; default?: string }
	| {
			kind: "number";
			name: string;
			title?: string;
			description?: string;
			default?: number;
			minimum?: number;
	  }
	| { kind: "boolean"; name: string; title?: string; description?: string; default?: boolean }
	| {
			kind: "select";
			name: string;
			title?: string;
			description?: string;
			multiple: boolean;
			options: SelectOption[];
	  };

// Loose on purpose: the runner reads a handful of fields and records the rest verbatim.
type Update = { type: string; subtype?: string; [key: string]: unknown };

interface TimedUpdate {
	/** ms since the prompt was sent. */
	t: number;
	messageId: string;
	update: Update;
}

interface Answer {
	elicitationId: string;
	toolUuid?: string;
	t: number;
	questions: Array<{ question: string; options: string[] }>;
	content: Record<string, string | number | boolean | string[]>;
}

interface Reservation {
	kind: "job" | "sandbox";
	flavor: string;
	priceMicroUsdPerMinute: number;
	ceilingMicroUsd: number;
	jobId?: string;
	namespace?: string;
}
interface MlBudget {
	totalMicroUsd: number;
	spentMicroUsd: number;
	reservations: Reservation[];
}
interface ConversationSnapshot {
	rootMessageId: string;
	messages: Array<{ id: string; from: string; content: string }>;
	mlBudget?: MlBudget;
	turnState?: { messageId: string; status: string };
}

// ── Small helpers ─────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const text = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));
/** the eval token reaches tool output through the hub mcp server and sandboxes */
const redact = (value: string) => (HF_TOKEN ? value.replaceAll(HF_TOKEN, "[HF_TOKEN]") : value);
// CI logs are public
const log = (...args: unknown[]) =>
	console.error("[ml-eval]", ...args.map((a) => redact(a instanceof Error ? String(a) : text(a))));

function requireEnv() {
	if (!HF_TOKEN) {
		console.error("HF_TOKEN is required: it launches the jobs and seeds the session.");
		process.exit(2);
	}
}

async function whoami(): Promise<{
	id: string;
	name: string;
	fullname?: string;
	avatarUrl?: string;
}> {
	const res = await fetch(`${HUB}/api/whoami-v2`, {
		headers: { Authorization: `Bearer ${HF_TOKEN}` },
	});
	if (!res.ok) throw new Error(`whoami failed: ${res.status} ${await res.text()}`);
	return (await res.json()) as { id: string; name: string; fullname?: string; avatarUrl?: string };
}

// ── Stack: Mongo, seeded session, app ─────────────────────────────────────────

async function startMongo() {
	const { MongoMemoryServer } = await import("mongodb-memory-server");
	// Matches the version pinned in src/lib/server/database.ts so CI reuses the cached binary.
	return MongoMemoryServer.create({ instance: { dbName: DB_NAME }, binary: { version: "7.0.18" } });
}

/** A user and session the app resolves from the cookie, carrying HF_TOKEN as its OAuth token. */
async function seedSession(mongoUrl: string): Promise<{ cookie: string; username: string }> {
	const me = await whoami();
	const client = await MongoClient.connect(mongoUrl, { directConnection: true });
	try {
		const db = client.db(DB_NAME);
		const now = new Date();
		const day = new Date(now.getTime() + 24 * 60 * 60 * 1000);
		const userId = new ObjectId();
		await db.collection("users").insertOne({
			_id: userId,
			username: me.name,
			name: me.fullname ?? me.name,
			avatarUrl: me.avatarUrl,
			hfUserId: me.id,
			createdAt: now,
			updatedAt: now,
		});
		const secret = randomUUID();
		await db.collection("sessions").insertOne({
			_id: new ObjectId(),
			// The app keys sessions by the SHA-256 of the cookie value.
			sessionId: createHash("sha256").update(secret).digest("hex"),
			userId,
			expiresAt: day,
			createdAt: now,
			updatedAt: now,
			// No refresh token, so the app uses it as-is until expiresAt.
			oauth: { token: { value: HF_TOKEN, expiresAt: day } },
		});
		return { cookie: `${COOKIE_NAME}=${secret}`, username: me.name };
	} finally {
		await client.close();
	}
}

async function run(cmd: string, args: string[], env: NodeJS.ProcessEnv) {
	await new Promise<void>((resolve, reject) => {
		const child = spawn(cmd, args, { cwd: ROOT, env, stdio: ["ignore", "inherit", "inherit"] });
		child.on("exit", (code) =>
			code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))
		);
	});
}

function prodEnv(): Record<string, string> {
	const chart = yaml.load(readFileSync(join(ROOT, "chart/env/prod.yaml"), "utf8")) as {
		envVars: Record<string, string>;
	};
	return Object.fromEntries(
		Object.entries(chart.envVars).filter(([key]) => !SKIPPED_PROD_ENV.test(key))
	);
}

function appEnv(mongoUrl: string, scenarios: Scenario[]): NodeJS.ProcessEnv {
	const models = [...new Map(scenarios.map((s) => [s.model.id, s.model])).values()];
	return {
		...process.env,
		...prodEnv(),
		HOST: "127.0.0.1",
		PORT: String(PORT),
		NODE_ENV: "production",
		LOG_LEVEL: "info",
		MONGODB_URL: mongoUrl,
		MONGODB_DB_NAME: DB_NAME,
		MONGODB_DIRECT_CONNECTION: "true",
		PUBLIC_ORIGIN: APP_URL,
		// HuggingChat, as in production: this is what makes the pinned provider apply.
		PUBLIC_APP_ASSETS: "huggingchat",
		COOKIE_NAME,
		COOKIE_SECURE: "false",
		COOKIE_SAMESITE: "lax",
		// No OAuth login: the seeded session is the user.
		OPENID_CLIENT_ID: "",
		OPENID_CLIENT_SECRET: "",
		OPENAI_BASE_URL,
		OPENAI_API_KEY,
		USE_USER_TOKEN: "false",
		ENABLE_CONFIG_MANAGER: "false",
		// Only the ML Intern preset's Hub MCP server, which gets the user's token forwarded.
		MCP_SERVERS: "[]",
		MCP_FORWARD_HF_USER_TOKEN: "true",
		ML_ASSISTANT_MODE: "true",
		ML_ASSISTANT_MODELS: JSON.stringify(models),
		LLM_ROUTER_ROUTES_PATH: "",
		LLM_ROUTER_ARCH_BASE_URL: "",
	};
}

async function buildApp(scenarios: Scenario[]) {
	log("building the app (ML_EVAL_SKIP_BUILD=1 to reuse ./build)");
	// ML_ASSISTANT_MODE is a build-time flag, so it has to be in the build env too.
	await run("npm", ["run", "build"], appEnv("", scenarios));
}

async function startApp(
	mongoUrl: string,
	scenarios: Scenario[],
	logPath: string
): Promise<ChildProcess> {
	const env = appEnv(mongoUrl, scenarios);
	if (process.env.ML_EVAL_SKIP_BUILD !== "1") await buildApp(scenarios);

	const out = createWriteStream(logPath);
	const app = spawn("node", ["server.js"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
	app.stdout?.pipe(out);
	app.stderr?.pipe(out);

	const deadline = Date.now() + 120_000;
	while (Date.now() < deadline) {
		if (app.exitCode !== null) throw new Error(`app exited ${app.exitCode}, see ${logPath}`);
		try {
			const res = await fetch(`${APP_URL}/healthcheck`);
			if (res.status < 500) return app;
		} catch {
			// not listening yet
		}
		await sleep(1000);
	}
	throw new Error(`app did not come up on ${APP_URL}, see ${logPath}`);
}

// ── App client ────────────────────────────────────────────────────────────────

class AppClient {
	cookie: string;

	constructor(cookie: string) {
		this.cookie = cookie;
	}

	private headers(extra: Record<string, string> = {}) {
		return { cookie: this.cookie, origin: APP_URL, ...extra };
	}

	async createConversation(scenario: Scenario): Promise<{ id: string; rootMessageId: string }> {
		const res = await fetch(`${APP_URL}/conversation`, {
			method: "POST",
			headers: this.headers({ "content-type": "application/json" }),
			body: JSON.stringify({
				model: scenario.model.id,
				preprompt: "",
				mlAssistant: true,
				mlBudgetUsd: scenario.budgetUsd,
			}),
		});
		if (!res.ok) throw new Error(`create conversation: ${res.status} ${await res.text()}`);
		const body = (await res.json()) as { conversationId: string; conversation: string };
		const conv = superjson.parse<ConversationSnapshot>(body.conversation);
		return { id: body.conversationId, rootMessageId: conv.rootMessageId };
	}

	async getConversation(id: string): Promise<ConversationSnapshot> {
		const res = await fetch(`${APP_URL}/api/v2/conversations/${id}`, { headers: this.headers() });
		if (!res.ok) throw new Error(`get conversation: ${res.status} ${await res.text()}`);
		return superjson.parse<ConversationSnapshot>(await res.text());
	}

	/**
	 * Send a message and return once its assistant message exists. The POST stream
	 * itself is only drained: it closes early when the turn parks, so the turn is
	 * followed through `tail` instead.
	 */
	async send(convId: string, parentId: string, inputs: string): Promise<string> {
		const before = new Set((await this.getConversation(convId)).messages.map((m) => m.id));
		const form = new FormData();
		form.append("data", JSON.stringify({ id: parentId, inputs, timezone: "UTC" }));
		const res = await fetch(`${APP_URL}/conversation/${convId}`, {
			method: "POST",
			headers: this.headers(),
			body: form,
		});
		if (!res.ok) throw new Error(`send message: ${res.status} ${await res.text()}`);
		void res.body?.pipeTo(new WritableStream()).catch(() => {});

		for (let i = 0; i < 120; i++) {
			const conv = await this.getConversation(convId);
			const fresh = conv.messages.find((m) => m.from === "assistant" && !before.has(m.id));
			if (fresh) return fresh.id;
			await sleep(500);
		}
		throw new Error("the assistant message never appeared");
	}

	async answer(convId: string, elicitationId: string, content: Answer["content"]) {
		const res = await fetch(`${APP_URL}/conversation/${convId}/elicitation`, {
			method: "POST",
			headers: this.headers({ "content-type": "application/json", accept: "application/json" }),
			body: JSON.stringify({ elicitationId, action: "accept", content, timezone: "UTC" }),
		});
		if (!res.ok && res.status !== 409) {
			throw new Error(`answer elicitation: ${res.status} ${await res.text()}`);
		}
	}

	async stop(convId: string) {
		await fetch(`${APP_URL}/conversation/${convId}/stop-generating`, {
			method: "POST",
			headers: this.headers({ "content-type": "application/json" }),
			body: "{}",
		}).catch(() => {});
	}

	/**
	 * Follow a turn over SSE until it ends, across park/resume cycles and the
	 * stream's 5-minute connection cap. The log replays from the start, so every
	 * update of the turn passes through `onUpdate` exactly once.
	 */
	async tail(
		convId: string,
		messageId: string,
		deadline: number,
		onUpdate: (update: Update) => Promise<void>
	): Promise<string> {
		let cursor = 0;
		let gone = 0;
		while (Date.now() < deadline) {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), Math.max(0, deadline - Date.now()));
			let ended: string | undefined;
			try {
				const res = await fetch(
					`${APP_URL}/conversation/${convId}/stream?messageId=${messageId}&fromSeq=${cursor}`,
					{ headers: this.headers({ accept: "text/event-stream" }), signal: controller.signal }
				);
				if (!res.ok || !res.body) throw new Error(`stream: ${res.status}`);
				const reader = res.body.getReader();
				const decoder = new TextDecoder();
				let buffer = "";
				for (;;) {
					const { done, value } = await reader.read();
					if (done) break;
					buffer += decoder.decode(value, { stream: true });
					let sep: number;
					while ((sep = buffer.indexOf("\n\n")) !== -1) {
						const frame = parseFrame(buffer.slice(0, sep));
						buffer = buffer.slice(sep + 2);
						if (frame.event === "update" && frame.data) {
							if (frame.id !== undefined) cursor = frame.id;
							await onUpdate(JSON.parse(frame.data) as Update);
						} else if (frame.event === "end") {
							ended = (JSON.parse(frame.data || "{}") as { status?: string }).status ?? "ended";
						}
					}
					if (ended) break;
				}
			} catch (err) {
				if (!controller.signal.aborted) log("stream dropped, reconnecting:", String(err));
			} finally {
				clearTimeout(timer);
				controller.abort();
			}
			// "gone" before any update just means the generation has not registered yet.
			if (ended === "gone" && cursor === 0 && ++gone < 20) {
				await sleep(500);
				continue;
			}
			if (ended) return ended;
			await sleep(500);
		}
		return "timeout";
	}
}

function parseFrame(raw: string): { event?: string; data?: string; id?: number } {
	const frame: { event?: string; data?: string; id?: number } = {};
	for (const line of raw.split("\n")) {
		const idx = line.indexOf(":");
		if (idx <= 0) continue;
		const field = line.slice(0, idx);
		const value = line.slice(idx + 1).replace(/^ /, "");
		if (field === "event") frame.event = value;
		else if (field === "id") frame.id = Number(value);
		else if (field === "data") frame.data = frame.data ? `${frame.data}\n${value}` : value;
	}
	return frame;
}

// ── Answering ask_user_question ───────────────────────────────────────────────

function answerField(
	field: ElicitationField,
	scenario: Scenario
): string | number | boolean | string[] {
	switch (field.kind) {
		case "string":
			return field.default ?? scenario.nudge ?? "Use your best judgment.";
		case "number":
			return field.default ?? field.minimum ?? 1;
		case "boolean":
			return field.default ?? true;
		case "select": {
			// Budget options would move the cap the checks measure against.
			const options = field.options.filter((o) => o.setBudgetUsd === undefined);
			const pool = options.length > 0 ? options : field.options;
			const haystack = [field.title, field.description, ...pool.map((o) => o.label)].join(" ");
			const rule = scenario.answers?.find((r) => r.question.test(haystack));
			const picked =
				(rule && pool.find((o) => rule.choose.test(`${o.label} ${o.description ?? ""}`))) ??
				pool.find((o) => /recommend/i.test(`${o.label} ${o.description ?? ""}`)) ??
				pool[0];
			return field.multiple ? [picked.value] : picked.value;
		}
	}
}

// ── Grading ───────────────────────────────────────────────────────────────────

const TERMINAL_STAGES = new Set(["COMPLETED", "CANCELED", "ERROR", "DELETED"]);

/**
 * What the conversation's jobs actually cost. The app settles lazily (at the
 * start of the next generation), so when a turn ends its finished jobs are
 * usually still held as reservations: settle them here the way settle.ts does,
 * billed per started minute at the price frozen on the reservation. A job the
 * agent left running is cancelled, and billed up to now.
 */
async function settleCost(
	budget: MlBudget | undefined
): Promise<{ costUsd: number; leftRunning: string[] }> {
	if (!budget) return { costUsd: 0, leftRunning: [] };
	let micro = budget.spentMicroUsd;
	const leftRunning: string[] = [];
	for (const r of budget.reservations) {
		if (!r.jobId || !r.namespace) {
			micro += r.ceilingMicroUsd;
			continue;
		}
		const url = `${HUB}/api/jobs/${encodeURIComponent(r.namespace)}/${r.jobId}`;
		const headers = { Authorization: `Bearer ${HF_TOKEN}` };
		const res = await fetch(url, { headers });
		if (!res.ok) {
			micro += r.ceilingMicroUsd;
			continue;
		}
		const job = (await res.json()) as Record<string, unknown>;
		const stage = (job.status as { stage?: string } | undefined)?.stage;
		if (!stage || !TERMINAL_STAGES.has(stage)) {
			leftRunning.push(r.jobId);
			await fetch(`${url}/cancel`, { method: "POST", headers }).catch(() => {});
		}
		const started = job.startedAt ?? job.started_at;
		const finished = job.finishedAt ?? job.finished_at;
		if (!started) continue;
		const end = finished ? new Date(finished as string) : new Date();
		const minutes = Math.ceil(
			Math.max(0, end.getTime() - new Date(started as string).getTime()) / 60_000
		);
		micro += Math.min(r.ceilingMicroUsd, r.priceMicroUsdPerMinute * minutes);
	}
	return { costUsd: micro / 1_000_000, leftRunning };
}

const TRACKIO_TOOLS = /^(hf_(jobs|sandbox)(_|$)|create_trackio$)/;
const SPACE_URL = /huggingface\.co\/spaces\/([A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*[A-Za-z0-9])/g;

/** Trackio Spaces the agent reserved or linked, the way the UI finds them (src/lib/utils/trackio.ts). */
function trackioSpaces(updates: TimedUpdate[]): string[] {
	const spaces = new Set<string>();
	for (const { update } of updates) {
		if (update.type !== "tool" || update.subtype !== "result") continue;
		const result = update.result as { status: string; call: { name: string }; outputs?: unknown[] };
		if (result.status !== "success" || !TRACKIO_TOOLS.test(result.call.name)) continue;
		for (const match of text(result.outputs).matchAll(SPACE_URL)) {
			if (match[1].toLowerCase().includes("trackio")) spaces.add(match[1]);
		}
	}
	return [...spaces];
}

async function spaceExists(id: string): Promise<boolean> {
	const res = await fetch(`${HUB}/api/spaces/${id}`, {
		headers: { Authorization: `Bearer ${HF_TOKEN}` },
	});
	return res.ok;
}

const normalizeAccuracy = (value: number) => (value > 1 ? value / 100 : value);

async function trackioCli<T>(args: string[], space: string): Promise<T> {
	const { stdout } = await execFileAsync("trackio", [...args, "--space", space, "--json"], {
		env: { ...process.env, HF_TOKEN },
		timeout: 120_000,
		maxBuffer: 32 * 1024 * 1024,
	});
	return JSON.parse(stdout) as T;
}

/** Last accuracy value logged to the dashboard: test/val/eval accuracy over train accuracy. */
async function trackioAccuracy(space: string): Promise<number | undefined> {
	try {
		const { projects } = await trackioCli<{ projects: string[] }>(["list", "projects"], space);
		for (const project of projects.reverse()) {
			const { runs } = await trackioCli<{ runs: string[] }>(
				["list", "runs", "--project", project],
				space
			);
			for (const runName of runs.reverse()) {
				const run = await trackioCli<{ metrics: string[] }>(
					["get", "run", "--project", project, "--run", runName],
					space
				);
				const accuracies = run.metrics.filter((m) => /acc/i.test(m));
				const metric = accuracies.find((m) => /test|val|eval/i.test(m)) ?? accuracies[0];
				if (!metric) continue;
				const { values } = await trackioCli<{ values: Array<{ value: number }> }>(
					["get", "metric", "--project", project, "--run", runName, "--metric", metric],
					space
				);
				const last = values.at(-1)?.value;
				if (typeof last === "number") return normalizeAccuracy(last);
			}
		}
	} catch (err) {
		log(`could not read metrics from ${space} (is the trackio CLI installed?):`, String(err));
	}
	return undefined;
}

/** The last "accuracy ... 0.97" / "accuracy: 97.3%" in the final answer. */
function reportedAccuracy(answer: string): number | undefined {
	const matches = [...answer.matchAll(/accuracy\D{0,40}?(\d+(?:\.\d+)?)\s*(%?)/gi)];
	const last = matches.at(-1);
	if (!last) return undefined;
	const value = Number(last[1]);
	return last[2] === "%" ? value / 100 : normalizeAccuracy(value);
}

// ── Trace (for Trackio) ───────────────────────────────────────────────────────

const clip = (value: string, max = 20_000) =>
	value.length > max ? `${value.slice(0, max)}\n… [${value.length - max} chars clipped]` : value;

/**
 * The turn as OpenAI-style messages plus one span per tool call, the shape
 * `trackio.Trace` takes. Answers to ask_user_question appear as user messages.
 */
function buildTrace(
	prompt: string,
	nudges: Array<{ t: number; text: string }>,
	updates: TimedUpdate[],
	answers: Answer[],
	startedAt: number
) {
	const messages: Array<Record<string, unknown>> = [{ role: "user", content: prompt }];
	const spans: Array<Record<string, unknown>> = [];
	const open = new Map<string, { span: Record<string, unknown>; t: number }>();
	const iso = (t: number) => new Date(startedAt + t).toISOString();
	let content = "";
	let reasoning = "";
	let pendingCalls: Array<Record<string, unknown>> = [];

	const flush = () => {
		if (!content && !reasoning && pendingCalls.length === 0) return;
		messages.push({
			role: "assistant",
			content,
			...(reasoning ? { reasoning_content: reasoning } : {}),
			...(pendingCalls.length ? { tool_calls: pendingCalls } : {}),
		});
		content = "";
		reasoning = "";
		pendingCalls = [];
	};

	const events = [
		...updates.map((u) => ({ t: u.t, kind: "update" as const, u })),
		...answers.map((a) => ({ t: a.t, kind: "answer" as const, a })),
		...nudges.map((n) => ({ t: n.t, kind: "nudge" as const, n })),
	].sort((x, y) => x.t - y.t);

	for (const event of events) {
		if (event.kind === "answer") {
			flush();
			const lines = event.a.questions.map(
				(q, i) => `${q.question} → ${text(Object.values(event.a.content)[i])}`
			);
			messages.push({ role: "user", content: `[answered ask_user_question]\n${lines.join("\n")}` });
			continue;
		}
		if (event.kind === "nudge") {
			flush();
			messages.push({ role: "user", content: event.n.text });
			continue;
		}
		const { update, t } = event.u;
		if (update.type === "stream") {
			content += text(update.token).replace(/\0/g, "");
		} else if (update.type === "reasoning" && update.subtype === "stream") {
			reasoning += text(update.token);
		} else if (update.type === "tool" && update.subtype === "call") {
			if (content) flush();
			const call = update.call as { name: string; parameters: unknown };
			const uuid = text(update.uuid);
			pendingCalls.push({
				id: uuid,
				type: "function",
				function: { name: call.name, arguments: JSON.stringify(call.parameters) },
			});
			const span = {
				id: uuid,
				parent_id: "turn",
				name: call.name,
				kind: "tool",
				start_time: iso(t),
				input: call.parameters,
			};
			open.set(uuid, { span, t });
			spans.push(span);
		} else if (
			update.type === "tool" &&
			(update.subtype === "result" || update.subtype === "error")
		) {
			flush();
			const uuid = text(update.uuid);
			const result = update.result as
				{ status?: string; outputs?: Array<{ text?: string }>; message?: string } | undefined;
			const output =
				result?.status === "success"
					? (result.outputs ?? []).map((o) => o.text ?? text(o)).join("\n")
					: (result?.message ?? text(update.message ?? update));
			const opened = open.get(uuid);
			messages.push({
				role: "tool",
				tool_call_id: uuid,
				name: opened?.span.name,
				content: clip(output),
			});
			if (opened) {
				const { span } = opened;
				span.end_time = iso(t);
				span.duration_ms = t - opened.t;
				span.status = result?.status === "success" ? "ok" : "error";
				span.output = clip(output);
				open.delete(uuid);
			}
		} else if (update.type === "finalAnswer") {
			content = text(update.text);
			flush();
		}
	}
	flush();
	return { messages, spans };
}

async function repoInfo(id: string, type: "models" | "spaces"): Promise<RepoInfo | undefined> {
	const res = await fetch(`${HUB}/api/${type}/${id}`, {
		headers: { Authorization: `Bearer ${HF_TOKEN}` },
	});
	return res.ok ? ((await res.json()) as RepoInfo) : undefined;
}

const minutesSince = (startedAt: number) => Number(((Date.now() - startedAt) / 60_000).toFixed(1));

/** polls the hub for each artifact the task asks for, then waits a while for one still building */
function watchArtifacts(
	scenario: Scenario,
	names: RunNames,
	startedAt: number,
	updates: TimedUpdate[]
) {
	const seen: Partial<Record<ArtifactKind, number | null>> = Object.fromEntries(
		scenario.artifacts.map((kind) => [kind, null])
	);
	const pending = new Set<ArtifactKind>();
	const check = async () => {
		pending.clear();
		for (const kind of scenario.artifacts) {
			if (seen[kind] != null) continue;
			let ready = false;
			if (kind === "trackio") {
				ready = (await Promise.all(trackioSpaces(updates).map(spaceExists))).some(Boolean);
			} else {
				const at = artifactRepo(kind, names);
				const info = at && (await repoInfo(at.id, at.type));
				ready = info !== undefined && artifactReady(kind, info);
				if (info && !ready) pending.add(kind);
			}
			if (ready) seen[kind] = minutesSince(startedAt);
		}
	};
	const safeCheck = () => check().catch((err) => log("artifact poll failed:", String(err)));
	let running = safeCheck();
	const timer = setInterval(() => {
		running = running.then(safeCheck);
	}, ARTIFACT_POLL_MS);
	return {
		async stop(graceMs = 10 * 60_000) {
			clearInterval(timer);
			await running;
			await safeCheck();
			const until = Date.now() + graceMs;
			while (pending.size > 0 && Date.now() < until) {
				await sleep(30_000);
				await safeCheck();
			}
			return seen;
		},
	};
}

/** hidden_checks.py as a cpu job billed apart from the agent budget */
async function runHiddenCheck(args: string[], names: RunNames): Promise<HiddenResult> {
	const script = join(ROOT, "evals/ml-intern/hidden_checks.py");
	const jobArgs = ["jobs", "uv", "run", "--flavor", "cpu-upgrade", "--timeout", "45m"];
	jobArgs.push("--secrets", "HF_TOKEN", "--label", "ml-eval-hidden-check", script);
	try {
		const { stdout, stderr } = await execFileAsync(
			"hf",
			[...jobArgs, ...args.map((a) => fill(a, names))],
			{
				env: { ...process.env, HF_TOKEN },
				timeout: 60 * 60_000,
				maxBuffer: 64 * 1024 * 1024,
			}
		);
		return parseHiddenResult(`${stdout}\n${stderr}`) ?? { pass: false, error: "no RESULT line" };
	} catch (err) {
		const output = (err as { stdout?: string }).stdout ?? "";
		return parseHiddenResult(output) ?? { pass: false, error: String(err).slice(0, 500) };
	}
}

/** the run conversations as the daily export writes them, relaxed ejson gzipped one per line */
async function exportConversations(mongoUrl: string, ids: string[], dir: string) {
	const client = await MongoClient.connect(mongoUrl, { directConnection: true });
	try {
		const docs = await client
			.db(DB_NAME)
			.collection("conversations")
			.find({ _id: { $in: ids.map((id) => new ObjectId(id)) } })
			.toArray();
		mkdirSync(dir, { recursive: true });
		const lines = docs
			.map((doc) => redact(BSON.EJSON.stringify(doc, { relaxed: true })))
			.join("\n");
		writeFileSync(join(dir, "conversations-eval.ndjson.gz"), gzipSync(`${lines}\n`));
	} finally {
		await client.close();
	}
}

async function measureConversations(
	exportsDir: string,
	outDir: string
): Promise<Map<string, ConversationMetrics>> {
	await execFileAsync(
		"python3",
		["-I", join(ROOT, "evals/metrics/metrics.py"), exportsDir, "--out", outDir],
		{
			maxBuffer: 64 * 1024 * 1024,
		}
	);
	const rows = JSON.parse(readFileSync(join(outDir, "conversations.json"), "utf8")) as Array<
		ConversationMetrics & { conversation: string }
	>;
	return new Map(rows.map((r) => [r.conversation, r]));
}

// ── One scenario ──────────────────────────────────────────────────────────────

async function runScenario(client: AppClient, scenario: Scenario, repeat: number, names: RunNames) {
	const prompt = fill(scenario.prompt, names);
	const label = `${scenario.name}#${repeat}`;
	log(`▶ ${label}: ${prompt}`);
	const conv = await client.createConversation(scenario);
	const startedAt = Date.now();
	const deadline = startedAt + scenario.timeoutMinutes * 60_000;
	const updates: TimedUpdate[] = [];
	const answers: Answer[] = [];
	const nudges: Array<{ t: number; text: string }> = [];
	const answered = new Set<string>();
	const watcher = watchArtifacts(scenario, names, startedAt, updates);

	let parentId = conv.rootMessageId;
	let input = prompt;
	let turnStatus = "unknown";
	for (let round = 0; round < 2; round++) {
		const messageId = await client.send(conv.id, parentId, input);
		turnStatus = await client.tail(conv.id, messageId, deadline, async (update) => {
			updates.push({ t: Date.now() - startedAt, messageId, update });
			if (update.type === "tool" && update.subtype === "call") {
				log(`  ${label} tool: ${(update.call as { name: string }).name}`);
			}
			if (update.type !== "elicitation" || update.subtype !== "request") return;
			const request = update.request as { elicitationId: string; fields: ElicitationField[] };
			if (answered.has(request.elicitationId)) return;
			answered.add(request.elicitationId);
			const content = Object.fromEntries(
				request.fields.map((f) => [f.name, answerField(f, scenario)])
			);
			answers.push({
				elicitationId: request.elicitationId,
				toolUuid: update.toolUuid as string | undefined,
				t: Date.now() - startedAt,
				questions: request.fields.map((f) => ({
					question: [f.title, f.description].filter(Boolean).join(": "),
					options: f.kind === "select" ? f.options.map((o) => o.label) : [],
				})),
				content,
			});
			log(`  ${label} answered: ${JSON.stringify(content)}`);
			await client.answer(conv.id, request.elicitationId, content);
		});
		if (turnStatus === "timeout") await client.stop(conv.id);

		// A turn that stops without launching anything most likely asked in prose.
		const launched = updates.some(
			(u) =>
				u.update.type === "tool" &&
				/^hf_(jobs|sandbox)/.test(text((u.update.call as { name?: string })?.name))
		);
		if (launched || !scenario.nudge || turnStatus === "timeout" || round > 0) break;
		log(`  ${label} turn ended without launching anything, nudging once`);
		nudges.push({ t: Date.now() - startedAt, text: scenario.nudge });
		parentId = messageId;
		input = scenario.nudge;
	}
	const durationSec = (Date.now() - startedAt) / 1000;
	const artifactMinutes = await watcher.stop();

	const snapshot = await client.getConversation(conv.id);
	const { costUsd, leftRunning } = await settleCost(snapshot.mlBudget);
	const finalAnswer =
		[...updates]
			.reverse()
			.find((u) => u.update.type === "finalAnswer")
			?.update.text?.toString() ??
		[...snapshot.messages].reverse().find((m) => m.from === "assistant")?.content ??
		"";
	const spaces = trackioSpaces(updates);
	const existing = (
		await Promise.all(spaces.map(async (s) => ((await spaceExists(s)) ? s : undefined)))
	).filter((s): s is string => s !== undefined);
	let trackioAcc: number | undefined;
	for (const space of existing) {
		trackioAcc = await trackioAccuracy(space);
		if (trackioAcc !== undefined) break;
	}

	let hidden: HiddenResult | undefined;
	if (scenario.hidden) {
		const repos = scenario.artifacts.filter((k) => k !== "trackio");
		hidden = repos.some((k) => artifactMinutes[k] != null)
			? await runHiddenCheck(scenario.hidden, names)
			: { pass: false, error: "the artifact was never usable" };
		log(`  ${label} hidden check: ${JSON.stringify(hidden)}`);
	}

	const outcome: ScenarioOutcome = {
		durationSec,
		costUsd,
		trackioSpaces: spaces,
		trackioSpaceExists: existing.length > 0,
		trackioAccuracy: trackioAcc,
		reportedAccuracy: reportedAccuracy(finalAnswer),
		artifactMinutes,
		askedFirst: askedFirst(updates, nudges[0]?.t),
		hidden,
		finalAnswer,
		toolCalls: updates
			.filter((u) => u.update.type === "tool" && u.update.subtype === "call")
			.map((u) => (u.update.call as { name: string }).name),
		turnStatus,
	};
	if (leftRunning.length)
		log(`  ${label} cancelled jobs it left running: ${leftRunning.join(", ")}`);

	return {
		name: scenario.name,
		repeat,
		prompt,
		model: scenario.model,
		timeoutMinutes: scenario.timeoutMinutes,
		artifacts: scenario.artifacts,
		repo: names.repo,
		space: names.space,
		conversationId: conv.id,
		startedAt,
		outcome,
		answers,
		nudges,
		leftRunning,
		budget: snapshot.mlBudget,
		updates,
	};
}

type RunRecord = Awaited<ReturnType<typeof runScenario>>;

function grade(run: RunRecord, scenario: Scenario, metrics: ConversationMetrics | undefined) {
	const outcome = { ...run.outcome, metrics };
	const checks: Check[] = [
		{
			name: "turn completed",
			pass: outcome.turnStatus === "completed",
			actual: outcome.turnStatus,
		},
		...scenario.checks(outcome),
	];
	const passed = checks.every((c) => c.pass);
	const trace = buildTrace(run.prompt, run.nudges, run.updates, run.answers, run.startedAt);
	trace.spans.unshift({
		id: "turn",
		name: `${run.name}#${run.repeat}`,
		kind: "span",
		start_time: new Date(run.startedAt).toISOString(),
		end_time: new Date(run.startedAt + outcome.durationSec * 1000).toISOString(),
		duration_ms: outcome.durationSec * 1000,
		status: passed ? "ok" : "error",
		model: `${run.model.id}:${run.model.provider}`,
	});
	for (const c of checks)
		log(`  ${run.name}#${run.repeat} ${c.pass ? "✓" : "✗"} ${c.name}: ${c.actual}`);
	return {
		...run,
		outcome,
		passed,
		checks,
		trace: {
			...trace,
			metadata: {
				status: passed ? "ok" : "error",
				duration_ms: outcome.durationSec * 1000,
				cost_usd: outcome.costUsd,
				model: `${run.model.id}:${run.model.provider}`,
				checks: Object.fromEntries(
					checks.map((c) => [c.name, `${c.pass ? "pass" : "FAIL"}: ${c.actual}`])
				),
			},
		},
	};
}

// ── Main ──────────────────────────────────────────────────────────────────────

type GradedRun = ReturnType<typeof grade>;
type CrashedRun = Pick<GradedRun, "name" | "repeat" | "passed" | "checks">;

function summaryMarkdown(runs: Array<GradedRun | CrashedRun>, tracesUrl?: string) {
	const lines = ["## ML Intern outcome eval", ""];
	if (tracesUrl) lines.push(`Traces: ${tracesUrl}`, "");
	lines.push(
		"| task | run | checks | minutes | cost | failed jobs | minutes to first artifact |",
		"|---|---|---|---|---|---|---|"
	);
	for (const r of runs) {
		const passed = r.checks.filter((c) => c.pass).length;
		const o = "outcome" in r ? r.outcome : undefined;
		const m = o?.metrics;
		const minutes = o ? (o.durationSec / 60).toFixed(1) : "–";
		const cost = o ? `$${o.costUsd.toFixed(2)}` : "–";
		const first =
			m?.minutes_to_first_artifact === "" ? "none" : (m?.minutes_to_first_artifact ?? "–");
		lines.push(
			`| ${r.name} | ${r.repeat} | ${r.passed ? "✅" : "❌"} ${passed}/${r.checks.length} | ${minutes} | ${cost} | ${m?.failed ?? "–"} | ${first} |`
		);
	}
	lines.push("");
	for (const r of runs.filter((r) => !r.passed)) {
		lines.push(
			`**${r.name} #${r.repeat}:** ` +
				r.checks
					.filter((c) => !c.pass)
					.map((c) => `${c.name} (${c.actual})`)
					.join("; ")
		);
	}
	return lines.join("\n");
}

async function gitSha(): Promise<string> {
	try {
		return (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: ROOT })).stdout.trim();
	} catch {
		return "unknown";
	}
}

async function main() {
	requireEnv();
	const wanted = (process.env.ML_EVAL_SCENARIO ?? "").split(",").filter(Boolean);
	const scenarios = SCENARIOS.filter((s) => wanted.length === 0 || wanted.includes(s.name));
	if (scenarios.length === 0) throw new Error(`no task named ${process.env.ML_EVAL_SCENARIO}`);
	const repeats = Math.max(1, Number(process.env.ML_EVAL_REPEATS ?? 1));
	if (process.env.ML_EVAL_BUILD_ONLY === "1") {
		await buildApp(scenarios);
		return;
	}

	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const outDir = process.env.ML_EVAL_OUT || join(ROOT, "eval-output", "ml-intern", stamp);
	mkdirSync(outDir, { recursive: true });
	const runId = randomUUID().slice(0, 6);

	const mongo = await startMongo();
	let app: ChildProcess | undefined;
	let username = "";
	const runs: Array<GradedRun | CrashedRun> = [];
	try {
		const mongoUrl = mongo.getUri();
		const seeded = await seedSession(mongoUrl);
		username = seeded.username;
		log(`running as ${username}, run ${runId}, ${scenarios.length} tasks × ${repeats}`);
		app = await startApp(mongoUrl, scenarios, join(outDir, "server.log"));
		const client = new AppClient(seeded.cookie);
		const plan = scenarios.flatMap((scenario) =>
			Array.from({ length: repeats }, (_, repeat) => ({ scenario, repeat }))
		);
		const settled = await Promise.allSettled(
			plan.map(({ scenario, repeat }) =>
				runScenario(client, scenario, repeat, runNames(username, scenario.name, runId, repeat))
			)
		);
		const finished: RunRecord[] = [];
		settled.forEach((s, i) => {
			if (s.status === "fulfilled") finished.push(s.value);
			else log(`✗ ${plan[i].scenario.name}#${plan[i].repeat} crashed:`, s.reason);
		});

		let metrics = new Map<string, ConversationMetrics>();
		try {
			const exportsDir = join(outDir, "exports");
			await exportConversations(
				mongoUrl,
				finished.map((r) => r.conversationId),
				exportsDir
			);
			metrics = await measureConversations(exportsDir, join(outDir, "metrics"));
		} catch (err) {
			log("production measures failed:", String(err));
		}
		for (const run of finished) {
			const scenario = scenarios.find((s) => s.name === run.name) as Scenario;
			runs.push(grade(run, scenario, metrics.get(run.conversationId)));
		}
		settled.forEach((s, i) => {
			if (s.status === "fulfilled") return;
			const { scenario, repeat } = plan[i];
			runs.push({
				name: scenario.name,
				repeat,
				passed: false,
				checks: [{ name: "ran", pass: false, actual: String(s.reason) }],
			});
		});
	} finally {
		app?.kill("SIGTERM");
		await mongo.stop();
	}

	const resultPath = join(outDir, "result.json");
	const runName = process.env.ML_EVAL_RUN_NAME || stamp;
	writeFileSync(
		resultPath,
		redact(
			JSON.stringify(
				{
					runName,
					sha: await gitSha(),
					runId,
					repeats,
					createdAt: new Date().toISOString(),
					scenarios: runs,
				},
				null,
				2
			)
		)
	);
	log(`wrote ${resultPath}`);

	let tracesUrl: string | undefined;
	const tracesName = process.env.ML_EVAL_TRACES_SPACE;
	if (tracesName) {
		const tracesSpace = tracesName.includes("/") ? tracesName : `${username}/${tracesName}`;
		log(`uploading traces to ${tracesSpace}`);
		try {
			await run(
				"python3",
				[join(ROOT, "evals/ml-intern/log_traces.py"), resultPath, "--space", tracesSpace],
				process.env
			);
			tracesUrl = `${HUB}/spaces/${tracesSpace}`;
		} catch (err) {
			log("trace upload failed:", String(err));
		}
	}

	const summary = summaryMarkdown(runs, tracesUrl);
	writeFileSync(join(outDir, "summary.md"), `${summary}\n`);
	console.log(summary);
	if (process.env.GITHUB_STEP_SUMMARY)
		appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
	process.exit(0);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
