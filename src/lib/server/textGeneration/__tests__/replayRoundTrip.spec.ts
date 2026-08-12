/**
 * End-to-end harness for reasoning preservation and tool-history replay (#2470).
 *
 * Everything between the HTTP handler and MongoDB is real: the route, the tree
 * builder, `runMcpFlow`, `executeToolCalls`, `prepareMessagesWithFiles`, and the
 * persistence path with its update compression. Only two edges are scripted —
 * the OpenAI-compatible upstream and the MCP tool server — because those are the
 * two things a test can't provide honestly.
 *
 * That placement is the point. The unit specs build `EndpointMessage` fixtures by
 * hand and feed them straight to `prepareMessagesWithFiles`, so they can only
 * prove the pure function is correct about inputs a test wrote. They cannot catch
 * a field that the live loop never persists, that `compressUpdatesForStorage`
 * drops, or that doesn't survive the round trip through Mongo — in which case
 * replay silently degrades to the old flat behavior with every unit test green.
 *
 * The assertion surface is the messages array captured on turn N+1's upstream
 * request: that IS the replayed history, exactly as a provider would receive it.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { collections, ready } from "$lib/server/database";
import {
	cleanupTestData,
	createTestConversation,
	createTestUser,
} from "$lib/server/api/__tests__/testHelpers";
import { MessageToolUpdateType, MessageUpdateType } from "$lib/types/MessageUpdate";
import type { Conversation } from "$lib/types/Conversation";
import type { Message } from "$lib/types/Message";
import type { MessageToolCallUpdate } from "$lib/types/MessageUpdate";
import { streamFor, describeMessages, type ChatMessage, type Round } from "./replayHarness";

// ── Scripted edges ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
	create: vi.fn(),
	callMcpTool: vi.fn(),
}));

vi.mock("openai", () => ({
	OpenAI: class {
		chat = { completions: { create: mocks.create } };
	},
}));

vi.mock("$lib/server/mcp/registry", () => ({
	getMcpServers: () => [{ name: "mock", url: "https://mock.test/mcp" }],
	loadMcpServersOnStartup: () => [],
}));

// Only the URL gate: the rest of the module (ssrfSafeFetch and friends) is used
// elsewhere in the import graph and must keep its real behavior.
vi.mock("$lib/server/urlSafety", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/server/urlSafety")>()),
	isValidUrl: () => true,
}));

vi.mock("$lib/server/mcp/tools", () => ({
	getOpenAiToolsForMcp: async () => ({
		tools: [
			{
				type: "function",
				function: {
					name: "get_weather",
					description: "Get the weather",
					parameters: {
						type: "object",
						properties: { city: { type: "string" } },
						required: ["city"],
					},
				},
			},
			{
				type: "function",
				function: {
					name: "get_forecast",
					description: "Get the forecast",
					parameters: {
						type: "object",
						properties: { city: { type: "string" } },
						required: ["city"],
					},
				},
			},
		],
		mapping: {
			get_weather: { fnName: "get_weather", server: "mock", tool: "get_weather" },
			get_forecast: { fnName: "get_forecast", server: "mock", tool: "get_forecast" },
		},
	}),
	resetMcpToolsCache: () => {},
}));

vi.mock("$lib/server/mcp/httpClient", () => ({
	callMcpTool: mocks.callMcpTool,
	getMcpToolTimeoutMs: () => 2_000,
}));

vi.mock("$lib/server/mcp/clientPool", () => ({
	getClient: async () => ({}),
}));

// The flow logs a paragraph per round; at ~20 turns per run that buries the
// assertion output. Mocked by resolved path, so `../../logger` is covered too.
vi.mock("$lib/server/logger", () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() },
}));

const { POST, PATCH } = await import("../../../../routes/conversation/[id]/+server");

// ── Driving a turn ────────────────────────────────────────────────────────────

/** Matches `test-org/test-model` in the models fixture: tools + image support. */
const MODEL_ID = "test-org/test-model";

/** Queue the upstream completions, in order, across every turn of a test. */
function scriptRounds(rounds: Round[]) {
	let next = 0;
	mocks.create.mockImplementation(async () => {
		const round = rounds[next++];
		if (!round) throw new Error(`upstream called ${next}x but only ${rounds.length} scripted`);
		if (round.error) throw round.error;
		return streamFor(round);
	});
}

/** Every scripted tool call resolves with `text`, or reports an error result. */
function scriptToolResult(response: { text?: string; isError?: boolean; content?: unknown[] }) {
	mocks.callMcpTool.mockImplementation(async () => ({
		text: response.text ?? "",
		isError: response.isError ?? false,
		structured: undefined,
		content: response.content ?? [{ type: "text", text: response.text ?? "" }],
	}));
}

/**
 * Send one user message through the real route and wait for the generation to
 * finish and persist. Draining the response body to completion is what makes the
 * final `persistConversation()` run, so it is not optional.
 */
async function sendMessage(
	conv: Conversation,
	locals: App.Locals,
	prompt: string,
	opts: { withTools?: boolean } = {}
): Promise<void> {
	// Append to the current leaf. The route requires an explicit parent for any
	// message after the root, exactly as the client sends one.
	const parentId = conv.messages.at(-1)?.id;
	const form = new FormData();
	form.set(
		"data",
		JSON.stringify({
			inputs: prompt,
			...(parentId ? { id: parentId } : {}),
			...(opts.withTools === false
				? {}
				: { selectedMcpServers: [{ name: "mock", url: "https://mock.test/mcp", headers: [] }] }),
		})
	);

	const response = await POST({
		request: new Request(`http://localhost/conversation/${conv._id}`, {
			method: "POST",
			body: form,
		}),
		locals,
		params: { id: conv._id.toString() },
		getClientAddress: () => "127.0.0.1",
	} as never);

	// Surface a route-level rejection instead of silently asserting on an
	// unchanged conversation later.
	if (response.status !== 200) {
		throw new Error(`POST returned ${response.status}: ${await response.text()}`);
	}
	const reader = response.body?.getReader();
	if (!reader) throw new Error("no response body");
	for (;;) {
		const { done } = await reader.read();
		if (done) break;
	}
}

/**
 * Send a message and stop reading partway, the way a browser that navigates
 * away does. Triggers the route's `cancel()` path, which persists whatever the
 * turn had produced so far — the only way to get a message with tool calls that
 * never recorded an outcome.
 */
async function sendMessageAndDetach(
	conv: Conversation,
	locals: App.Locals,
	prompt: string,
	chunksToRead: number
): Promise<void> {
	const parentId = conv.messages.at(-1)?.id;
	const form = new FormData();
	form.set(
		"data",
		JSON.stringify({
			inputs: prompt,
			...(parentId ? { id: parentId } : {}),
			selectedMcpServers: [{ name: "mock", url: "https://mock.test/mcp", headers: [] }],
		})
	);

	const response = await POST({
		request: new Request(`http://localhost/conversation/${conv._id}`, {
			method: "POST",
			body: form,
		}),
		locals,
		params: { id: conv._id.toString() },
		getClientAddress: () => "127.0.0.1",
	} as never);

	const reader = response.body?.getReader();
	if (!reader) throw new Error("no response body");
	for (let i = 0; i < chunksToRead; i += 1) {
		const { done } = await reader.read();
		if (done) return;
	}
	await reader.cancel();
}

/** The messages array sent on the nth upstream completion request (0-indexed). */
function outgoing(n: number): ChatMessage[] {
	const call = mocks.create.mock.calls[n];
	if (!call) throw new Error(`no upstream request #${n} (saw ${mocks.create.mock.calls.length})`);
	return call[0].messages as ChatMessage[];
}

/** Re-read the conversation from Mongo — never trust the in-memory copy. */
async function reload(conv: Conversation): Promise<Conversation> {
	const fresh = await collections.conversations.findOne({ _id: conv._id });
	if (!fresh) throw new Error("conversation vanished");
	return fresh;
}

const assistantMessages = (conv: Conversation): Message[] =>
	conv.messages.filter((m) => m.from === "assistant");

const callUpdatesOf = (message: Message): MessageToolCallUpdate[] =>
	(message.updates ?? []).filter(
		(u): u is MessageToolCallUpdate =>
			u.type === MessageUpdateType.Tool && u.subtype === MessageToolUpdateType.Call
	);

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
	await ready;
});

beforeEach(() => {
	mocks.create.mockReset();
	mocks.callMcpTool.mockReset();
	scriptToolResult({ text: "18°C, sunny" });
});

afterEach(async () => {
	await cleanupTestData();
});

/**
 * A conversation already in tree form, with the empty system root the app
 * creates. Starting from a legacy (rootMessageId-less) conversation would send
 * the route down its one-time conversion path instead of the normal one.
 */
async function newConversation() {
	const { locals } = await createTestUser();
	const rootId = crypto.randomUUID();
	const conv = await createTestConversation(locals, {
		model: MODEL_ID,
		title: "t",
		rootMessageId: rootId,
		messages: [
			{
				id: rootId,
				from: "system",
				content: "",
				ancestors: [],
				children: [],
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		],
	});
	return { conv, locals };
}

/**
 * The models fixture leaves `supportsReasoning` at its default (false), so the
 * per-user override is how a spec turns cross-turn reasoning on. That is the
 * same switch production resolves first — it wins over the capability flag in
 * both directions — so driving it here exercises the real gate rather than a
 * stand-in for it.
 */
async function setReasoningOverride(locals: App.Locals, value: boolean) {
	await collections.settings.updateOne(
		locals.user ? { userId: locals.user._id } : { sessionId: locals.sessionId },
		{
			$set: { [`reasoningOverrides.${MODEL_ID}`]: value },
			$setOnInsert: {
				...(locals.user ? { userId: locals.user._id } : { sessionId: locals.sessionId }),
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		},
		{ upsert: true }
	);
}

// ── The round trip ────────────────────────────────────────────────────────────

describe.sequential("tool history survives the round trip through Mongo", () => {
	it("replays a past tool round as assistant/tool pairs on the next turn", async () => {
		const { conv, locals } = await newConversation();
		scriptRounds([
			{ toolCalls: [{ id: "call_abc123", name: "get_weather", arguments: '{"city":"Paris"}' }] },
			{ content: "It is 18°C in Paris." },
			{ content: "Yes, still sunny." },
		]);
		scriptToolResult({ text: "18°C, sunny, station_id=Q7M4-XP29" });

		await sendMessage(conv, locals, "Weather in Paris?");
		await sendMessage(await reload(conv), locals, "Still sunny?");

		// Turn 2's payload is the replayed history.
		const replayed = outgoing(2);
		const shape = describeMessages(replayed);

		// system, user, assistant(tool_calls), tool, assistant(answer), user
		expect(
			replayed.filter((m) => m.role === "tool"),
			shape
		).toHaveLength(1);
		const assistantWithCalls = replayed.find((m) => m.tool_calls);
		expect(assistantWithCalls, shape).toBeDefined();
		expect(assistantWithCalls?.tool_calls?.[0].function.name).toBe("get_weather");

		// The fact only the tool knows must reach the model — this is the whole
		// point of replay, and the one thing a flat history cannot carry.
		const toolMessage = replayed.find((m) => m.role === "tool");
		expect(String(toolMessage?.content)).toContain("Q7M4-XP29");
	});

	it("persists argumentsRaw and replays it byte-exact instead of reserializing", async () => {
		const { conv, locals } = await newConversation();
		// Nested object + a non-primitive: the sanitized `parameters` fallback keeps
		// only top-level primitives, so reserializing would silently drop `units`.
		const rawArgs = '{"city":"Paris","units":{"temp":"C"},"detailed":true}';
		scriptRounds([
			{ toolCalls: [{ id: "call_abc123", name: "get_weather", arguments: rawArgs }] },
			{ content: "Done." },
			{ content: "Follow-up." },
		]);

		await sendMessage(conv, locals, "Weather in Paris?");

		// It has to be in the database, not just in the stream.
		const stored = await reload(conv);
		const [call] = callUpdatesOf(assistantMessages(stored)[0]);
		expect(call.argumentsRaw).toBe(rawArgs);
		expect(call.originalId).toBe("call_abc123");

		await sendMessage(stored, locals, "And tomorrow?");

		const replayed = outgoing(2);
		const assistantWithCalls = replayed.find((m) => m.tool_calls);
		expect(assistantWithCalls?.tool_calls?.[0].function.arguments).toBe(rawArgs);
	});

	it("normalizes the replayed tool_call_id to nine alphanumerics and pairs it with its result", async () => {
		const { conv, locals } = await newConversation();
		scriptRounds([
			{
				toolCalls: [{ id: "call_provider_id_way_too_long", name: "get_weather", arguments: "{}" }],
			},
			{ content: "Done." },
			{ content: "Follow-up." },
		]);

		await sendMessage(conv, locals, "Weather?");
		await sendMessage(await reload(conv), locals, "Again?");

		const replayed = outgoing(2);
		const callId = replayed.find((m) => m.tool_calls)?.tool_calls?.[0].id;
		const resultId = replayed.find((m) => m.role === "tool")?.tool_call_id;

		expect(callId).toMatch(/^[a-zA-Z0-9]{9}$/);
		expect(resultId).toBe(callId);
	});
});

// ── Turns that ended badly ────────────────────────────────────────────────────
//
// #2472 ("preserve work on failure") stopped discarding a turn's tool work when
// the flow ends badly, so these half-finished turns now persist and get replayed
// on the next request. Replaying a shape a provider rejects breaks the whole
// conversation from then on, not just the turn that failed.

describe.sequential("replaying a turn that ended badly", () => {
	/**
	 * Characterisation, like the image-only case below.
	 *
	 * A turn that died mid-tool replays with no assistant message between the last
	 * tool result and the next user message, because an interrupted turn produced
	 * no final text and an empty trailing assistant message represents a turn that
	 * never happened. `tool` -> `user` is a shape production never emitted before
	 * replay existed, and Mistral-family templates enforce role alternation.
	 *
	 * Manual testing against the real router cleared it: providers accepted the
	 * shape. Pinned here so the ordering is at least deliberate. NOT yet verified
	 * against a Mistral-family model specifically — if one ever rejects this, the
	 * fix is to emit a minimal assistant message rather than to relax the test.
	 */
	it("replays an interrupted turn as tool followed directly by user (accepted by providers)", async () => {
		const { conv, locals } = await newConversation();
		// Round 1 calls a tool; round 2 (the follow-up completion) dies. Since
		// output was already produced, #2472 rethrows rather than falling back,
		// leaving a turn with tool work and no final answer.
		scriptRounds([
			{ toolCalls: [{ id: "call_abc123", name: "get_weather", arguments: '{"city":"Paris"}' }] },
			{ error: new Error("upstream died mid-run") },
			{ content: "Recovered." },
		]);

		await sendMessage(conv, locals, "Weather in Paris?");
		await sendMessage(await reload(conv), locals, "Are you still there?");

		const replayed = outgoing(2);
		const shape = describeMessages(replayed);

		// The genuine invariant: the interrupted round is still replayed, and its
		// result is still paired with its call, so tool_calls are never orphaned.
		const lastTool = replayed.map((m) => m.role).lastIndexOf("tool");
		expect(lastTool, shape).toBeGreaterThan(-1);
		expect(replayed[lastTool].tool_call_id, shape).toBe(
			replayed.find((m) => m.tool_calls)?.tool_calls?.[0].id
		);
		// Pinned so a change of ordering is deliberate. See the block comment.
		expect(replayed[lastTool + 1]?.role, shape).toBe("user");
	});

	it("marks a tool call that never recorded an outcome as interrupted", async () => {
		const { conv, locals } = await newConversation();
		scriptRounds([
			{ toolCalls: [{ id: "call_abc123", name: "get_weather", arguments: "{}" }] },
			{ content: "Never reached." },
			{ content: "Next turn." },
		]);
		// Hangs past the detach below, so the Result update is never emitted.
		mocks.callMcpTool.mockImplementation(
			() => new Promise((resolve) => setTimeout(() => resolve({ text: "late" }), 5_000))
		);

		await sendMessageAndDetach(conv, locals, "Weather?", 3);

		const stored = await reload(conv);
		const lastAssistant = assistantMessages(stored).at(-1);
		expect(callUpdatesOf(lastAssistant as Message).length).toBeGreaterThan(0);

		scriptToolResult({ text: "fine now" });
		await sendMessage(stored, locals, "Try again?");

		const replayed = outgoing(mocks.create.mock.calls.length - 1);
		const toolMessage = replayed.find((m) => m.role === "tool");
		// Fabricating an empty success here would teach the model the tool
		// returned nothing, rather than that it never finished.
		expect(String(toolMessage?.content)).toContain("interrupted");
	});

	it("replays an MCP error result as an error, not as a successful empty output", async () => {
		const { conv, locals } = await newConversation();
		scriptRounds([
			{ toolCalls: [{ id: "call_abc123", name: "get_weather", arguments: "{}" }] },
			{ content: "The tool failed." },
			{ content: "Follow-up." },
		]);
		// #2471 turned `isError: true` into an Error update rather than a Result.
		scriptToolResult({ text: "upstream weather API is down", isError: true });

		await sendMessage(conv, locals, "Weather?");
		await sendMessage(await reload(conv), locals, "And now?");

		const replayed = outgoing(2);
		const toolMessage = replayed.find((m) => m.role === "tool");
		expect(String(toolMessage?.content)).toContain("Error");
		expect(String(toolMessage?.content)).toContain("upstream weather API is down");
	});

	it("does not persist truncated tool arguments as replayable argumentsRaw", async () => {
		const { conv, locals } = await newConversation();
		// #2473 discards calls whose arguments were cut off by the output limit;
		// #2470 independently refuses to persist unparseable argumentsRaw. Either
		// guard alone is enough — assert the outcome, not which one fired.
		scriptRounds([
			{
				toolCalls: [{ id: "call_abc123", name: "get_weather", arguments: '{"city":"Pari' }],
				finishReason: "length",
			},
			{ content: "Answering without the tool." },
			{ content: "Follow-up." },
		]);

		await sendMessage(conv, locals, "Weather in Paris?");

		const stored = await reload(conv);
		for (const message of assistantMessages(stored)) {
			for (const call of callUpdatesOf(message)) {
				if (call.argumentsRaw !== undefined) {
					expect(() => JSON.parse(call.argumentsRaw as string)).not.toThrow();
				}
			}
		}

		await sendMessage(stored, locals, "Try again?");

		// Whatever survived, every replayed arguments string has to be parseable:
		// providers that validate the field reject the entire continuation, not
		// just the offending call.
		for (const message of outgoing(mocks.create.mock.calls.length - 1)) {
			for (const call of message.tool_calls ?? []) {
				expect(() => JSON.parse(call.function.arguments)).not.toThrow();
			}
		}
	});
});

// ── Reasoning: attribution and gating ─────────────────────────────────────────

describe.sequential("cross-turn reasoning", () => {
	it("attaches a past turn's reasoning as reasoning_content, never as visible text", async () => {
		const { conv, locals } = await newConversation();
		await setReasoningOverride(locals, true);
		scriptRounds([
			{ reasoning: "The user wants Paris weather.", content: "It is 18°C in Paris." },
			{ content: "Still sunny." },
		]);

		await sendMessage(conv, locals, "Weather in Paris?", { withTools: false });
		await sendMessage(await reload(conv), locals, "Still sunny?", { withTools: false });

		const replayed = outgoing(1);
		const shape = describeMessages(replayed);
		const past = replayed.find((m) => m.role === "assistant");

		expect(past?.reasoning_content, shape).toBe("The user wants Paris weather.");
		// Raw think markup as visible content is wrong for every model, and for
		// some (Gemma) the vendor requires historical thoughts to be gone entirely.
		expect(String(past?.content), shape).not.toContain("<think>");
		expect(String(past?.content), shape).toBe("It is 18°C in Paris.");
	});

	it("replays reasoning with no per-model configuration at all", async () => {
		// The whole point of the flip. Under the previous opt-in flag this model
		// — unflagged, no override, nothing in MODELS — silently lost its
		// reasoning, and nothing anywhere said so. Note there is no
		// setReasoningOverride call here, deliberately.
		const { conv, locals } = await newConversation();
		scriptRounds([
			{ reasoning: "The user wants Paris weather.", content: "It is 18°C in Paris." },
			{ content: "Still sunny." },
		]);

		await sendMessage(conv, locals, "Weather in Paris?", { withTools: false });
		await sendMessage(await reload(conv), locals, "Still sunny?", { withTools: false });

		const replayed = outgoing(1);
		const shape = describeMessages(replayed);
		const past = replayed.find((m) => m.role === "assistant");
		expect(past?.reasoning_content, shape).toBe("The user wants Paris weather.");
		expect(String(past?.content), shape).not.toContain("<think>");
	});

	it("sends no reasoning_content at all when the user turned reasoning off", async () => {
		const { conv, locals } = await newConversation();
		await setReasoningOverride(locals, false);
		scriptRounds([
			{ reasoning: "Thinking hard.", content: "It is 18°C in Paris." },
			{ content: "Still sunny." },
		]);

		await sendMessage(conv, locals, "Weather in Paris?", { withTools: false });
		await sendMessage(await reload(conv), locals, "Still sunny?", { withTools: false });

		const replayed = outgoing(1);
		const shape = describeMessages(replayed);
		expect(
			replayed.some((m) => m.reasoning_content !== undefined),
			shape
		).toBe(false);
		// Still stripped, not leaked as prose.
		expect(JSON.stringify(replayed), shape).not.toContain("<think>");
		expect(JSON.stringify(replayed), shape).not.toContain("Thinking hard");
	});

	it("accepts reasoning_text as a reasoning field alongside reasoning and reasoning_content", async () => {
		for (const field of ["reasoning", "reasoning_content", "reasoning_text"] as const) {
			const { conv, locals } = await newConversation();
			await setReasoningOverride(locals, true);
			scriptRounds([
				{ reasoning: `via ${field}`, reasoningField: field, content: "Answer." },
				{ content: "Next." },
			]);

			await sendMessage(conv, locals, "Question?", { withTools: false });
			await sendMessage(await reload(conv), locals, "Follow-up?", { withTools: false });

			const past = outgoing(1).find((m) => m.role === "assistant");
			expect(past?.reasoning_content, `field: ${field}`).toBe(`via ${field}`);
			mocks.create.mockReset();
			await cleanupTestData();
		}
	});

	it("keeps each tool round's reasoning and preamble on that round's own message", async () => {
		const { conv, locals } = await newConversation();
		await setReasoningOverride(locals, true);
		scriptRounds([
			{
				reasoning: "First I need the current weather.",
				content: "Let me check that.",
				toolCalls: [{ id: "call_one11111", name: "get_weather", arguments: '{"city":"Paris"}' }],
			},
			{
				reasoning: "Now the forecast.",
				content: "And the forecast.",
				toolCalls: [{ id: "call_two22222", name: "get_forecast", arguments: '{"city":"Paris"}' }],
			},
			{ reasoning: "I have both.", content: "Sunny now and all week." },
			{ content: "Follow-up." },
		]);

		await sendMessage(conv, locals, "Weather and forecast for Paris?");
		await sendMessage(await reload(conv), locals, "Thanks?");

		const replayed = outgoing(3);
		const shape = describeMessages(replayed);
		const withCalls = replayed.filter((m) => m.tool_calls);
		expect(withCalls, shape).toHaveLength(2);

		// Round reasoning belongs to the round that produced it. Piling every
		// round's thoughts onto the final answer misrepresents the order the
		// model actually thought in.
		expect(withCalls[0].reasoning_content, shape).toContain("current weather");
		expect(withCalls[1].reasoning_content, shape).toContain("forecast");
		expect(String(withCalls[0].content), shape).toBe("Let me check that.");
		expect(String(withCalls[1].content), shape).toBe("And the forecast.");

		// And the preamble must not ALSO survive on the final answer.
		const final = replayed.filter((m) => m.role === "assistant" && !m.tool_calls).at(-1);
		expect(String(final?.content), shape).not.toContain("Let me check that.");
		expect(String(final?.content), shape).toContain("Sunny now and all week.");
	});
});

// ── Producer gating across a model switch ─────────────────────────────────────

describe.sequential("model switching", () => {
	it("stops replaying the old model's reasoning after the pinned model changes", async () => {
		const { conv, locals } = await newConversation();
		await setReasoningOverride(locals, true);
		scriptRounds([
			{ reasoning: "Reasoning by the first model.", content: "First answer." },
			{ content: "Second answer." },
		]);

		await sendMessage(conv, locals, "Question?", { withTools: false });

		// The retired-model recovery banner and the model picker both land here.
		const patched = await PATCH({
			request: new Request(`http://localhost/conversation/${conv._id}`, {
				method: "PATCH",
				body: JSON.stringify({ model: "test-org/text-only" }),
			}),
			locals,
			params: { id: conv._id.toString() },
		} as never);
		expect(patched.status).toBe(200);

		const stored = await reload(conv);
		// The switch has to record who actually produced the earlier turns before
		// that information is gone — nothing else stamps it for a pinned model.
		expect(assistantMessages(stored)[0].routerMetadata?.model).toBe(MODEL_ID);

		await setReasoningOverride(locals, true);
		await sendMessage(stored, locals, "Follow-up?", { withTools: false });

		const replayed = outgoing(1);
		const shape = describeMessages(replayed);
		// Reasoning is conditioned on the producing model's own prior thoughts;
		// handing the first model's trace to a different one is unverified.
		expect(
			replayed.some((m) => m.reasoning_content !== undefined),
			shape
		).toBe(false);
		expect(JSON.stringify(replayed), shape).not.toContain("Reasoning by the first model");
	});

	it("derives the model's context window from the smallest provider that reports one", async () => {
		// The plumbing behind the context-aware budget: parsed off the provider
		// list in buildModels, carried on the model, and read at both
		// prepareMessagesWithFiles call sites. Nothing else asserts it survives
		// the parse, and a silent undefined would just restore the flat ceiling.
		const { models } = await import("$lib/server/models");
		const model = models.find((m) => m.id === MODEL_ID);
		expect(model?.contextLength).toBe(262144);
	});

	it("leaves the pinned model alone when a turn records a different producer", async () => {
		const { conv, locals } = await newConversation();
		scriptRounds([{ content: "First answer." }, { content: "Second answer." }]);
		await sendMessage(conv, locals, "Question?", { withTools: false });

		// What the "omni" alias produces: the turn is stamped with the candidate
		// that actually answered, which is not the model the conversation is
		// pinned to.
		await collections.conversations.updateOne(
			{ _id: conv._id },
			{
				$set: { "messages.$[m].routerMetadata": { route: "default", model: "test-org/text-only" } },
			},
			{ arrayFilters: [{ "m.from": "assistant" }] }
		);

		const stamped = await reload(conv);
		expect(assistantMessages(stamped)[0].routerMetadata?.model).toBe("test-org/text-only");
		await sendMessage(stamped, locals, "Follow-up?", { withTools: false });

		// Reopening must show the pin, not whichever model happened to answer
		// last — the GET handler returns `conversation.model` verbatim, so this
		// is what the picker renders. Recording the producer must stay a
		// data-only concern.
		const after = await reload(conv);
		expect(after.model).toBe(MODEL_ID);
		expect(assistantMessages(after)[0].routerMetadata?.model).toBe("test-org/text-only");
	});

	it("backfills the producer when the switch comes through the v2 API too", async () => {
		// The backfill used to live only in the legacy handler, so switching via
		// the public API left history unstamped and the next turn replayed one
		// model's reasoning onto another. Both endpoints now share one helper.
		const { PATCH: apiPatch } =
			await import("../../../../routes/api/v2/conversations/[id]/+server");
		const { conv, locals } = await newConversation();
		await setReasoningOverride(locals, true);
		scriptRounds([
			{ reasoning: "Reasoning by the first model.", content: "First answer." },
			{ content: "Second answer." },
		]);

		await sendMessage(conv, locals, "Question?", { withTools: false });

		const patched = await apiPatch({
			locals,
			params: { id: conv._id.toString() },
			request: new Request(`http://localhost/api/v2/conversations/${conv._id}`, {
				method: "PATCH",
				body: JSON.stringify({ model: "test-org/text-only" }),
			}),
		} as never);
		expect(patched.status).toBe(200);

		const stored = await reload(conv);
		expect(stored.model).toBe("test-org/text-only");
		expect(assistantMessages(stored)[0].routerMetadata?.model).toBe(MODEL_ID);

		await setReasoningOverride(locals, true);
		await sendMessage(stored, locals, "Follow-up?", { withTools: false });

		const replayed = outgoing(1);
		const shape = describeMessages(replayed);
		expect(
			replayed.some((m) => m.reasoning_content !== undefined),
			shape
		).toBe(false);
		expect(JSON.stringify(replayed), shape).not.toContain("Reasoning by the first model");
	});

	it("does not discard messages written between reading the conversation and applying the switch", async () => {
		const { conv, locals } = await newConversation();
		scriptRounds([{ content: "First answer." }]);
		await sendMessage(conv, locals, "Question?", { withTools: false });

		// The handler re-reads the conversation itself, so the race window is
		// inside it. Freezing what that read returns reproduces the window
		// deterministically: the snapshot predates the concurrent write below,
		// exactly as it would when a generation is streaming.
		const stale = await reload(conv);
		const findOne = vi
			.spyOn(collections.conversations, "findOne")
			.mockResolvedValueOnce(stale as never);

		const concurrent = {
			id: crypto.randomUUID(),
			from: "assistant" as const,
			content: "Written by an in-flight generation.",
			ancestors: [],
			children: [],
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		await collections.conversations.updateOne(
			{ _id: conv._id },
			{ $push: { messages: concurrent as never } }
		);

		const patched = await PATCH({
			request: new Request(`http://localhost/conversation/${conv._id}`, {
				method: "PATCH",
				body: JSON.stringify({ model: "test-org/text-only" }),
			}),
			locals,
			params: { id: conv._id.toString() },
		} as never);
		expect(patched.status).toBe(200);
		findOne.mockRestore();

		const after = await reload(conv);
		// Writing a mapped copy of the stale snapshot back over `messages` would
		// drop this message entirely — the failure mode is losing a turn the user
		// watched stream, not merely losing metadata.
		expect(after.messages.map((m) => m.content)).toContain("Written by an in-flight generation.");
		// ...and the backfill still has to have happened.
		expect(after.model).toBe("test-org/text-only");
		for (const message of after.messages.filter((m) => m.from === "assistant")) {
			expect(message.routerMetadata?.model).toBe(MODEL_ID);
		}
	});

	it("still replays tool calls and results across a model switch", async () => {
		const { conv, locals } = await newConversation();
		scriptRounds([
			{ toolCalls: [{ id: "call_abc123", name: "get_weather", arguments: '{"city":"Paris"}' }] },
			{ content: "It is 18°C." },
			{ content: "Follow-up." },
		]);
		scriptToolResult({ text: "18°C, station_id=Q7M4-XP29" });

		await sendMessage(conv, locals, "Weather?");
		await PATCH({
			request: new Request(`http://localhost/conversation/${conv._id}`, {
				method: "PATCH",
				body: JSON.stringify({ model: "test-org/text-only" }),
			}),
			locals,
			params: { id: conv._id.toString() },
		} as never);

		// Back to a tools-capable model so the MCP path runs again.
		await collections.conversations.updateOne({ _id: conv._id }, { $set: { model: MODEL_ID } });
		await sendMessage(await reload(conv), locals, "And now?");

		const replayed = outgoing(2);
		const shape = describeMessages(replayed);
		// A `tool` message is just data — protocol-neutral, and gating it would
		// lose facts the conversation depends on.
		expect(
			replayed.some((m) => m.role === "tool"),
			shape
		).toBe(true);
		expect(JSON.stringify(replayed), shape).toContain("Q7M4-XP29");
	});
});

// ── Budget and storage growth ─────────────────────────────────────────────────

describe.sequential("replay budget", () => {
	it("degrades the oldest turns to flat text, monotonically, without leaking think markup", async () => {
		const { conv, locals } = await newConversation();
		await setReasoningOverride(locals, true);
		// REPLAY_HISTORY_BUDGET_CHARS is 100k, so three turns of 45k reasoning
		// force the oldest one over the edge.
		const big = (tag: string) => `${tag} `.repeat(9_000);
		scriptRounds([
			{ reasoning: big("first"), content: "Answer one." },
			{ reasoning: big("second"), content: "Answer two." },
			{ reasoning: big("third"), content: "Answer three." },
			{ content: "Answer four." },
		]);

		let current = conv;
		for (const prompt of ["One?", "Two?", "Three?"]) {
			await sendMessage(current, locals, prompt, { withTools: false });
			current = await reload(conv);
		}
		await sendMessage(current, locals, "Four?", { withTools: false });

		const replayed = outgoing(3);
		const assistants = replayed.filter((m) => m.role === "assistant");
		const shape = describeMessages(replayed);
		expect(assistants, shape).toHaveLength(3);

		// Oldest first: once a turn falls back to flat, every older turn must too,
		// so the model never sees rich history for a stale turn while the turn it
		// is continuing from is plain prose.
		const hasReasoning = assistants.map((m) => m.reasoning_content !== undefined);
		expect(hasReasoning[0], shape).toBe(false);
		expect(hasReasoning.at(-1), shape).toBe(true);
		expect(hasReasoning.indexOf(true), shape).toBeGreaterThan(hasReasoning.lastIndexOf(false));

		// The degraded shape must still be think-stripped: dropping the
		// enrichment is fine, leaking the raw trace as visible content is not.
		expect(JSON.stringify(replayed), shape).not.toContain("<think>");
		expect(String(assistants[0].content), shape).toBe("Answer one.");
	});

	it("stores each round's reasoning exactly twice, so growth stays bounded", async () => {
		const { conv, locals } = await newConversation();
		await setReasoningOverride(locals, true);
		const trace = "UNIQUE-REASONING-MARKER";
		scriptRounds([
			{
				reasoning: trace,
				content: "Checking.",
				toolCalls: [{ id: "call_abc123", name: "get_weather", arguments: "{}" }],
			},
			{ content: "It is 18°C." },
		]);

		await sendMessage(conv, locals, "Weather?");

		const stored = await reload(conv);
		const serialized = JSON.stringify(stored);
		const occurrences = serialized.split(trace).length - 1;

		// Once inline in `content` as <think>, once on the round's Call update.
		// A third copy means something started duplicating per-round state, which
		// on a long tool-heavy conversation is what walks a document into the
		// 16MB BSON ceiling and makes it unsaveable.
		expect(occurrences, `reasoning appeared ${occurrences}x in the stored document`).toBe(2);
	});
});

// ── Tool results that carry no text ───────────────────────────────────────────

describe.sequential("tool results without text", () => {
	/**
	 * Characterisation, not an endorsement.
	 *
	 * An image-only MCP result reaches the model as `content: ""`. Manual testing
	 * against the real router settled the two open questions: providers ACCEPT the
	 * empty message (no 400), but the model is thereby told its tool produced
	 * nothing and confabulates — a 1x1 transparent PNG was described back to the
	 * user as "Swiss-style cheese with its characteristic holes". Meanwhile the UI
	 * renders the real image from the same Result update, so it looks like it
	 * worked.
	 *
	 * That bug pre-dates #2470 and belongs to the live loop, not replay:
	 * toolInvocation.ts builds in-loop tool messages from the joined text blocks
	 * alone ("we keep only the textual output"), so the first, non-replayed answer
	 * is already fabricated. Replay merely carries the same empty message forward.
	 *
	 * The fix is upstream of here — represent the image rather than dropping it —
	 * so this asserts today's behaviour instead of a shape replay should invent.
	 * The data is available: the blocks are persisted one field away, at
	 * `outputs[0].content`, while this path reads `outputs[0].text`. When that is
	 * addressed, flip the final assertion to require a representation.
	 */
	it("replays an image-only tool result as empty content (known upstream gap)", async () => {
		const { conv, locals } = await newConversation();
		scriptRounds([
			{ toolCalls: [{ id: "call_abc123", name: "get_weather", arguments: "{}" }] },
			{ content: "Here is the chart." },
			{ content: "Follow-up." },
		]);
		// `callMcpTool` joins only text blocks, so an image-only result has no
		// text at all — the shape an image-generating MCP tool produces.
		scriptToolResult({
			text: "",
			content: [{ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" }],
		});

		await sendMessage(conv, locals, "Chart the weather?");
		await sendMessage(await reload(conv), locals, "And now?");

		const replayed = outgoing(2);
		const shape = describeMessages(replayed);
		const toolMessage = replayed.find((m) => m.role === "tool");
		// The genuine invariant, and the one that must not regress: the result is
		// still replayed and still paired with its call, so the assistant's
		// tool_calls are never left orphaned.
		expect(toolMessage, shape).toBeDefined();
		expect(toolMessage?.tool_call_id, shape).toBe(
			replayed.find((m) => m.tool_calls)?.tool_calls?.[0].id
		);
		// Pinned so that representing the image becomes a deliberate, visible
		// change rather than a silent one. See the block comment above.
		expect(String(toolMessage?.content), shape).toBe("");
	});
});

// ── Data written before this feature existed ──────────────────────────────────

describe.sequential("conversations persisted before the replay fields existed", () => {
	it("replays a legacy tool round from sanitized parameters alone", async () => {
		const { locals } = await createTestUser();
		const rootId = crypto.randomUUID();
		const userId = crypto.randomUUID();
		const assistantId = crypto.randomUUID();
		// No reasoning / content / argumentsRaw / originalId anywhere: exactly what
		// a message written before #2470 looks like coming back out of Mongo.
		const conv = await createTestConversation(locals, {
			model: MODEL_ID,
			rootMessageId: rootId,
			messages: [
				{
					id: rootId,
					from: "system",
					content: "",
					ancestors: [],
					children: [userId],
					createdAt: new Date(),
					updatedAt: new Date(),
				},
				{
					id: userId,
					from: "user",
					content: "Weather?",
					ancestors: [rootId],
					children: [assistantId],
					createdAt: new Date(),
					updatedAt: new Date(),
				},
				{
					id: assistantId,
					from: "assistant",
					content: "It is 18°C in Paris.",
					ancestors: [rootId, userId],
					children: [],
					createdAt: new Date(),
					updatedAt: new Date(),
					updates: [
						{
							type: MessageUpdateType.Tool,
							subtype: MessageToolUpdateType.Call,
							uuid: "legacy-uuid-0001",
							call: { name: "get_weather", parameters: { city: "Paris" } },
						},
						{
							type: MessageUpdateType.Tool,
							subtype: MessageToolUpdateType.Result,
							uuid: "legacy-uuid-0001",
							result: {
								status: "success",
								call: { name: "get_weather", parameters: { city: "Paris" } },
								outputs: [{ text: "18°C, station_id=Q7M4-XP29" }],
							},
						},
					],
				} as unknown as Message,
			],
		});
		scriptRounds([{ content: "Still sunny." }]);

		await sendMessage(conv, locals, "Still sunny?");

		const replayed = outgoing(0);
		const shape = describeMessages(replayed);
		const assistantWithCalls = replayed.find((m) => m.tool_calls);
		expect(assistantWithCalls, shape).toBeDefined();
		// Falls back to reserializing the sanitized parameters.
		expect(assistantWithCalls?.tool_calls?.[0].function.arguments, shape).toBe('{"city":"Paris"}');
		expect(assistantWithCalls?.tool_calls?.[0].id, shape).toMatch(/^[a-zA-Z0-9]{9}$/);
		expect(JSON.stringify(replayed), shape).toContain("Q7M4-XP29");
	});
});
