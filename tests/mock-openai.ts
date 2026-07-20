/**
 * Mock OpenAI-compatible upstream implementing exactly the surface chat-ui touches:
 * `GET /v1/models`, `POST /v1/chat/completions` (streaming and not), `POST /v1/completions`.
 * The `/__control/*` plane lets a test script it from a different process.
 *
 * `SCENARIOS` shares its vocabulary with the in-process chunk fixtures in
 * `src/lib/server/__fixtures__/chunks.ts` — keep the two in sync so a regression found at one
 * level reproduces at the other.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { pathToFileURL } from "node:url";
import { MODELS_FIXTURE } from "../src/lib/server/__fixtures__/models.ts";

export const MOCK_OPENAI_PORT = Number(process.env.MOCK_OPENAI_PORT ?? 8788);

/** A tool call the upstream asks the app to perform. */
export interface ToolCallSpec {
	id: string;
	name: string;
	/** JSON-encoded arguments, exactly as a real provider sends them. */
	arguments: string;
}

/** Declarative rather than a callback so it can be JSON-serialised over the control plane. */
export interface ScenarioScript {
	/** Respond with this HTTP status instead of a stream. */
	errorStatus?: number;
	errorMessage?: string;
	/** Delay before the first chunk, ms. */
	initialDelayMs?: number;
	/** Delay between chunks, ms. */
	chunkDelayMs?: number;
	/** Reasoning tokens, emitted before content. */
	reasoning?: string[];
	/** Which delta field carries reasoning. Providers differ; both are handled. */
	reasoningField?: "reasoning" | "reasoning_content";
	/** Tool calls, emitted before content on the first turn only. */
	toolCalls?: ToolCallSpec[];
	/** Content tokens. */
	content?: string[];
	/** finish_reason on the final chunk. */
	finishReason?: "stop" | "length" | "tool_calls";
	/** Body for non-streaming requests (title generation, tool-call id recovery). */
	nonStreamContent?: string;
}

/** Select one per test with `mockOpenAI.setScenario(conversationId, "reasoning")`. */
export const SCENARIOS = {
	/** Plain assistant text, streamed token by token. The default. */
	plainText: {
		content: ["Hello", " from", " the", " mock", " server", "."],
		chunkDelayMs: 10,
		finishReason: "stop",
	},
	/** Reasoning tokens via `delta.reasoning`, then the answer. */
	reasoning: {
		reasoning: ["Let me ", "think ", "about ", "that."],
		reasoningField: "reasoning",
		content: ["The answer ", "is ", "42."],
		chunkDelayMs: 10,
		finishReason: "stop",
	},
	/** Same, but via `delta.reasoning_content` — the other provider shape. */
	reasoningContent: {
		reasoning: ["Considering ", "the ", "options."],
		reasoningField: "reasoning_content",
		content: ["Option ", "B ", "wins."],
		chunkDelayMs: 10,
		finishReason: "stop",
	},
	/**
	 * One tool call, then a text answer once the tool result comes back.
	 * Pairs with `e2e/mock-mcp.ts`, which exposes the `echo` tool.
	 */
	toolCall: {
		toolCalls: [{ id: "call_mock_1", name: "echo", arguments: '{"text":"ping"}' }],
		content: ["Tool ", "said ", "ping."],
		chunkDelayMs: 10,
		finishReason: "tool_calls",
	},
	/** A long, slow stream — long enough to reliably abort mid-flight. */
	slowStream: {
		content: Array.from({ length: 120 }, (_, i) => `token-${i} `),
		chunkDelayMs: 150,
		finishReason: "stop",
	},
	/** Upstream returns HTTP 500 before any content. */
	upstreamError: {
		errorStatus: 500,
		errorMessage: "mock upstream failure",
	},
	/** A well-formed stream that yields no content at all. */
	emptyStream: {
		content: [],
		finishReason: "stop",
	},
} satisfies Record<string, ScenarioScript>;

export type ScenarioName = keyof typeof SCENARIOS;

/** Anything a test can hand to `setScenario`. */
export type ScenarioSelector = ScenarioName | ScenarioScript;

/** One upstream request, recorded for assertions. */
export interface RecordedRequest {
	method: string;
	path: string;
	conversationId: string | null;
	stream: boolean;
	body: Record<string, unknown>;
	at: number;
}

const DEFAULT_KEY = "default";

function resolveScript(selector: ScenarioSelector): ScenarioScript {
	return typeof selector === "string" ? SCENARIOS[selector] : selector;
}

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let raw = "";
		req.on("data", (d) => (raw += d));
		req.on("end", () => resolve(raw));
		req.on("error", reject);
	});
}

function json(res: ServerResponse, status: number, payload: unknown): void {
	const body = JSON.stringify(payload);
	res.writeHead(status, {
		"content-type": "application/json",
		"content-length": Buffer.byteLength(body),
	});
	res.end(body);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ChunkDelta {
	role?: string;
	content?: string;
	reasoning?: string;
	reasoning_content?: string;
	tool_calls?: Array<{
		index: number;
		id: string;
		type: "function";
		function: { name: string; arguments: string };
	}>;
}

function chunk(model: string, delta: ChunkDelta, finish: string | null = null) {
	return {
		id: "chatcmpl-mock",
		object: "chat.completion.chunk",
		created: 0,
		model,
		choices: [{ index: 0, delta, finish_reason: finish }],
	};
}

export interface MockOpenAI {
	/** Base URL to hand to the app as `OPENAI_BASE_URL`, e.g. `http://127.0.0.1:8788/v1`. */
	baseUrl: string;
	/** Root origin, for the control plane. */
	origin: string;
	port: number;
	/** Script the upstream for one conversation (parallel-safe) or `"default"`. */
	setScenario(key: string, scenario: ScenarioSelector): void;
	/** Clear all scenario overrides and the request log. */
	reset(): void;
	/** Every upstream request seen so far. */
	requests(): RecordedRequest[];
	close(): Promise<void>;
}

export async function startMockOpenAI(port: number = MOCK_OPENAI_PORT): Promise<MockOpenAI> {
	/** conversation id (or "default") -> scenario */
	const overrides = new Map<string, ScenarioScript>();
	const recorded: RecordedRequest[] = [];

	const scenarioFor = (conversationId: string | null): ScenarioScript => {
		if (conversationId) {
			const scoped = overrides.get(conversationId);
			if (scoped) return scoped;
		}
		return overrides.get(DEFAULT_KEY) ?? SCENARIOS.plainText;
	};

	const server: Server = createServer((req, res) => {
		void handle(req, res).catch((err) => {
			if (!res.headersSent) json(res, 500, { error: String(err) });
			else res.end();
		});
	});

	async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
		const conversationId = (req.headers["chatui-conversation-id"] as string) || null;

		// ── Control plane ────────────────────────────────────────────────────────
		if (url.pathname === "/__control/health") {
			json(res, 200, { ok: true });
			return;
		}

		if (url.pathname === "/__control/scenario" && req.method === "POST") {
			const parsed = JSON.parse(await readBody(req)) as {
				key?: string;
				scenario: ScenarioSelector;
			};
			overrides.set(parsed.key ?? DEFAULT_KEY, resolveScript(parsed.scenario));
			json(res, 200, { ok: true });
			return;
		}

		if (url.pathname === "/__control/reset" && req.method === "POST") {
			overrides.clear();
			recorded.length = 0;
			json(res, 200, { ok: true });
			return;
		}

		if (url.pathname === "/__control/requests" && req.method === "GET") {
			json(res, 200, recorded);
			return;
		}

		// ── Model list — the app hard-requires this at boot ──────────────────────
		if (url.pathname === "/v1/models" && req.method === "GET") {
			json(res, 200, MODELS_FIXTURE);
			return;
		}

		// ── Legacy completions (endpointOai.ts:150) ──────────────────────────────
		if (url.pathname === "/v1/completions" && req.method === "POST") {
			const body = JSON.parse((await readBody(req)) || "{}") as Record<string, unknown>;
			recorded.push({
				method: "POST",
				path: url.pathname,
				conversationId,
				stream: false,
				body,
				at: Date.now(),
			});
			const script = scenarioFor(conversationId);
			json(res, 200, {
				id: "cmpl-mock",
				object: "text_completion",
				created: 0,
				model: String(body.model ?? MODELS_FIXTURE.data[0].id),
				choices: [{ index: 0, text: (script.content ?? []).join(""), finish_reason: "stop" }],
			});
			return;
		}

		// ── Chat completions ─────────────────────────────────────────────────────
		if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
			const body = JSON.parse((await readBody(req)) || "{}") as Record<string, unknown>;
			const wantsStream = body.stream === true;
			const model = String(body.model ?? MODELS_FIXTURE.data[0].id);
			const script = scenarioFor(conversationId);

			recorded.push({
				method: "POST",
				path: url.pathname,
				conversationId,
				stream: wantsStream,
				body,
				at: Date.now(),
			});

			if (script.errorStatus) {
				json(res, script.errorStatus, {
					error: { message: script.errorMessage ?? "mock upstream error", type: "server_error" },
				});
				return;
			}

			// The app echoes tool results back as `role: "tool"` messages. Once one
			// is present the tool call has already happened, so answer with text
			// instead — otherwise the flow loops forever.
			const messages = Array.isArray(body.messages) ? body.messages : [];
			const toolResultSeen = messages.some(
				(m) => typeof m === "object" && m !== null && (m as { role?: string }).role === "tool"
			);
			const emitToolCalls = Boolean(script.toolCalls?.length) && !toolResultSeen;

			// ── Non-streaming: title generation and tool-call id recovery ──────────
			if (!wantsStream) {
				json(res, 200, {
					id: "chatcmpl-mock",
					object: "chat.completion",
					created: 0,
					model,
					choices: [
						{
							index: 0,
							message: {
								role: "assistant",
								content: script.nonStreamContent ?? "Mock Title",
								...(emitToolCalls
									? {
											tool_calls: (script.toolCalls ?? []).map((t, index) => ({
												index,
												id: t.id,
												type: "function" as const,
												function: { name: t.name, arguments: t.arguments },
											})),
										}
									: {}),
							},
							finish_reason: emitToolCalls ? "tool_calls" : "stop",
						},
					],
				});
				return;
			}

			// ── Streaming ──────────────────────────────────────────────────────────
			res.writeHead(200, {
				"content-type": "text/event-stream",
				"cache-control": "no-cache",
				connection: "keep-alive",
			});

			let aborted = false;
			req.on("close", () => (aborted = true));
			const send = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

			if (script.initialDelayMs) await sleep(script.initialDelayMs);
			send(chunk(model, { role: "assistant", content: "" }));

			const reasoningField = script.reasoningField ?? "reasoning";
			for (const token of script.reasoning ?? []) {
				if (aborted) return;
				send(chunk(model, { [reasoningField]: token }));
				if (script.chunkDelayMs) await sleep(script.chunkDelayMs);
			}

			if (emitToolCalls) {
				for (const [index, tool] of (script.toolCalls ?? []).entries()) {
					if (aborted) return;
					send(
						chunk(model, {
							tool_calls: [
								{
									index,
									id: tool.id,
									type: "function",
									function: { name: tool.name, arguments: tool.arguments },
								},
							],
						})
					);
					if (script.chunkDelayMs) await sleep(script.chunkDelayMs);
				}
				if (aborted) return;
				send(chunk(model, {}, "tool_calls"));
				res.write("data: [DONE]\n\n");
				res.end();
				return;
			}

			for (const token of script.content ?? []) {
				if (aborted) return;
				send(chunk(model, { content: token }));
				if (script.chunkDelayMs) await sleep(script.chunkDelayMs);
			}

			if (aborted) return;
			send(chunk(model, {}, script.finishReason ?? "stop"));
			res.write("data: [DONE]\n\n");
			res.end();
			return;
		}

		json(res, 404, { error: "not found", path: url.pathname });
	}

	await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
	const actualPort = (server.address() as AddressInfo).port;
	const origin = `http://127.0.0.1:${actualPort}`;

	return {
		baseUrl: `${origin}/v1`,
		origin,
		port: actualPort,
		setScenario: (key, scenario) => overrides.set(key, resolveScript(scenario)),
		reset: () => {
			overrides.clear();
			recorded.length = 0;
		},
		requests: () => [...recorded],
		close: () =>
			new Promise<void>((resolve, reject) =>
				server.close((err) => (err ? reject(err) : resolve()))
			),
	};
}

// ── CLI mode: `vite-node e2e/mock-openai.ts` ─────────────────────────────────
const invokedDirectly =
	process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
	startMockOpenAI().then((mock) => {
		console.log(`[mock-openai] listening on ${mock.baseUrl}`);
	});
}
