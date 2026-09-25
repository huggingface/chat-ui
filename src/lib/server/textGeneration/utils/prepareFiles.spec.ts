import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import type { Conversation } from "$lib/types/Conversation";
import type { OpenAI } from "openai";
import { prepareHistory, prepareMessagesWithFiles, type HistoryMessage } from "./prepareFiles";
import { omittedMarker, planWindow, renderWindow, type HistoryUnit } from "./historyWindow";
import type { EndpointMessage } from "$lib/server/endpoints/endpoints";
import type { makeImageProcessor } from "$lib/server/endpoints/images";
import {
	MessageToolUpdateType,
	MessageUpdateType,
	type MessageUpdate,
} from "$lib/types/MessageUpdate";
import { ToolResultStatus } from "$lib/types/Tool";

const imageProcessor = (() => {
	throw new Error("imageProcessor should not be called in these tests");
}) as unknown as ReturnType<typeof makeImageProcessor>;

const callUpdate = (uuid: string, name: string, parameters: Record<string, string>) =>
	({
		type: MessageUpdateType.Tool,
		subtype: MessageToolUpdateType.Call,
		uuid,
		call: { name, parameters },
	}) satisfies MessageUpdate;

const resultUpdate = (uuid: string, name: string, text: string) =>
	({
		type: MessageUpdateType.Tool,
		subtype: MessageToolUpdateType.Result,
		uuid,
		result: {
			status: ToolResultStatus.Success,
			call: { name, parameters: {} },
			outputs: [{ text }],
		},
	}) satisfies MessageUpdate;

const errorUpdate = (uuid: string, message: string) =>
	({
		type: MessageUpdateType.Tool,
		subtype: MessageToolUpdateType.Error,
		uuid,
		message,
	}) satisfies MessageUpdate;

describe("prepareMessagesWithFiles tool history replay", () => {
	it("keeps flat {role, content} messages when replay is off", async () => {
		const messages: EndpointMessage[] = [
			{ from: "user", content: "hi" },
			{
				from: "assistant",
				content: "hello",
				updates: [callUpdate("u1", "get_weather", { city: "Paris" })],
			},
		];
		const prepared = await prepareMessagesWithFiles(messages, imageProcessor, false);
		expect(prepared).toEqual([
			{ role: "user", content: "hi" },
			{ role: "assistant", content: "hello" },
		]);
	});

	it("expands tool rounds into assistant/tool pairs and splits reasoning", async () => {
		const messages: EndpointMessage[] = [
			{ from: "user", content: "weather in Paris?" },
			{
				from: "assistant",
				content: "<think>need the tool</think>It is 18°C and sunny in Paris.",
				updates: [
					callUpdate("u1", "get_weather", { city: "Paris" }),
					resultUpdate("u1", "get_weather", "18°C, sunny"),
					callUpdate("u2", "get_forecast", { city: "Paris" }),
					resultUpdate("u2", "get_forecast", "sunny all week"),
				],
			},
		];
		const prepared = await prepareMessagesWithFiles(messages, imageProcessor, false, {
			replayToolHistory: true,
		});

		expect(prepared).toEqual([
			{ role: "user", content: "weather in Paris?" },
			{
				role: "assistant",
				tool_calls: [
					{
						id: "u10000000",
						type: "function",
						function: { name: "get_weather", arguments: JSON.stringify({ city: "Paris" }) },
					},
				],
			},
			{ role: "tool", tool_call_id: "u10000000", content: "18°C, sunny" },
			{
				role: "assistant",
				tool_calls: [
					{
						id: "u20000000",
						type: "function",
						function: { name: "get_forecast", arguments: JSON.stringify({ city: "Paris" }) },
					},
				],
			},
			{ role: "tool", tool_call_id: "u20000000", content: "sunny all week" },
			{
				role: "assistant",
				content: "It is 18°C and sunny in Paris.",
				reasoning_content: "need the tool",
			},
		]);
		// Mistral-family templates require exactly nine alphanumeric chars
		for (const m of prepared) {
			if (m.role === "tool") expect(m.tool_call_id).toMatch(/^[a-zA-Z0-9]{9}$/);
		}
		// tool-call messages must not carry a content key at all
		const withToolCalls = prepared.filter((m) => "tool_calls" in m);
		for (const message of withToolCalls) {
			expect("content" in message).toBe(false);
		}
	});

	it("replays a virtual-file call with the reference the model wrote, never the expanded content", async () => {
		const raw = '{"operation":"uv","args":{"script":"v-file://train.py","flavor":"cpu-basic"}}';
		const messages: EndpointMessage[] = [
			{ from: "user", content: "train it" },
			{
				from: "assistant",
				content: "Submitted.",
				updates: [
					{
						...callUpdate("u1", "hf_jobs", { operation: "uv" }),
						argumentsRaw: raw,
						fileRefs: [{ ref: "v-file://train.py", name: "train.py", version: 4 }],
					},
					resultUpdate("u1", "hf_jobs", "job started"),
				],
			},
		];
		const prepared = await prepareMessagesWithFiles(messages, imageProcessor, false, {
			replayToolHistory: true,
		});
		const assistant = prepared[1];
		if (assistant.role !== "assistant" || !assistant.tool_calls) throw new Error("no tool_calls");
		expect(assistant.tool_calls[0].function.arguments).toBe(raw);
		expect(JSON.stringify(prepared)).not.toContain("fileRefs");
	});

	it("groups parallel calls of one round into a single assistant message", async () => {
		const messages: EndpointMessage[] = [
			{
				from: "assistant",
				content: "done",
				updates: [
					callUpdate("a", "search", { q: "x" }),
					callUpdate("b", "search", { q: "y" }),
					resultUpdate("a", "search", "res-a"),
					errorUpdate("b", "timeout"),
				],
			},
		];
		const prepared = await prepareMessagesWithFiles(messages, imageProcessor, false, {
			replayToolHistory: true,
		});
		expect(prepared).toEqual([
			{
				role: "assistant",
				tool_calls: [
					{
						id: "a00000000",
						type: "function",
						function: { name: "search", arguments: '{"q":"x"}' },
					},
					{
						id: "b00000000",
						type: "function",
						function: { name: "search", arguments: '{"q":"y"}' },
					},
				],
			},
			{ role: "tool", tool_call_id: "a00000000", content: "res-a" },
			{ role: "tool", tool_call_id: "b00000000", content: "Error: timeout" },
			{ role: "assistant", content: "done" },
		]);
	});

	it("marks calls without a persisted outcome as interrupted instead of empty success", async () => {
		const messages: EndpointMessage[] = [
			{
				from: "assistant",
				content: "",
				updates: [callUpdate("u1", "get_weather", { city: "Paris" })],
			},
		];
		const prepared = await prepareMessagesWithFiles(messages, imageProcessor, false, {
			replayToolHistory: true,
		});
		expect(prepared[1]).toEqual({
			role: "tool",
			tool_call_id: "u10000000",
			content: "Error: interrupted before a result was recorded",
		});
	});

	it("omits the trailing assistant message entirely when a turn was interrupted before any final text or reasoning", async () => {
		const messages: EndpointMessage[] = [
			{
				from: "assistant",
				content: "",
				updates: [
					callUpdate("u1", "get_weather", { city: "Paris" }),
					resultUpdate("u1", "get_weather", "18°C"),
				],
			},
		];
		const prepared = await prepareMessagesWithFiles(messages, imageProcessor, false, {
			replayToolHistory: true,
		});
		// No trailing { role: "assistant", content: "" } — just the tool round.
		expect(prepared).toEqual([
			{
				role: "assistant",
				tool_calls: [
					{
						id: "u10000000",
						type: "function",
						function: { name: "get_weather", arguments: JSON.stringify({ city: "Paris" }) },
					},
				],
			},
			{ role: "tool", tool_call_id: "u10000000", content: "18°C" },
		]);
	});

	it("omits an all-empty plain assistant message (no tool calls, no text, no reasoning) entirely", async () => {
		const messages: EndpointMessage[] = [
			{ from: "user", content: "hi" },
			{ from: "assistant", content: "" },
		];
		const prepared = await prepareMessagesWithFiles(messages, imageProcessor, false, {
			replayToolHistory: true,
		});
		expect(prepared).toEqual([{ role: "user", content: "hi" }]);
	});

	it("degrades the oldest turns to flat messages once the replay budget is spent", async () => {
		// Each turn carries ~28×8k of tool output, so two turns exceed the 400k
		// budget: the newest keeps its tool history, the oldest goes flat.
		const bigTurn = (prefix: string): EndpointMessage => ({
			from: "assistant",
			content: `${prefix} done`,
			updates: Array.from({ length: 28 }, (_, i) => [
				callUpdate(`${prefix}${i}`, "search", { q: String(i) }),
				resultUpdate(`${prefix}${i}`, "search", "x".repeat(8000)),
			]).flat(),
		});
		const messages: EndpointMessage[] = [
			bigTurn("old"),
			{ from: "user", content: "next" },
			bigTurn("new"),
		];
		const prepared = await prepareMessagesWithFiles(messages, imageProcessor, false, {
			replayToolHistory: true,
		});
		expect(prepared[0]).toEqual({ role: "assistant", content: "old done" });
		expect(prepared[1]).toEqual({ role: "user", content: "next" });
		expect(prepared.filter((m) => m.role === "tool")).toHaveLength(28);
	});

	it("charges plain messages against the budget, but ballast can never flatten the newest turn", async () => {
		// The cap covers the whole outgoing history, so a user turn large enough
		// to consume the budget flattens OLDER tool turns. The newest replayable
		// turn is exempt: it is the turn a continuation resumes into, and its
		// transcript is the run's working state — only a window that could not
		// carry it at all may degrade it (see the newest-candidate rule).
		const toolTurn = (id: string): EndpointMessage => ({
			from: "assistant",
			content: `${id} done`,
			updates: [callUpdate(id, "search", { q: "x" }), resultUpdate(id, "search", `${id} result`)],
		});

		const withBallast = await prepareMessagesWithFiles(
			[
				{ from: "user", content: "x".repeat(450_000) },
				toolTurn("older"),
				{ from: "user", content: "next" },
				toolTurn("newest"),
			],
			imageProcessor,
			false,
			{ replayToolHistory: true }
		);
		const toolMessages = withBallast.filter((m) => m.role === "tool");
		expect(toolMessages).toHaveLength(1);
		expect(String(toolMessages[0]?.content)).toContain("newest result");
		// The older turn degraded, never dropped — and the user's text is untouched.
		expect(withBallast).toContainEqual({ role: "assistant", content: "older done" });
		expect(withBallast.filter((m) => m.role === "user")).toHaveLength(2);
	});

	it("keeps a failed turn's replay through a resume message, dangling call repaired", async () => {
		// The resume-after-failure shape: the newest assistant turn died mid-tool-call
		// and a user message follows it asking the model to continue. The exemption is
		// positional (newest assistant candidate), so the trailing user message must
		// not cost the failed turn its transcript — that transcript is exactly the
		// work resume exists to preserve — and the call that never recorded a result
		// must replay as an explicit interruption, not be dropped or 400 the request.
		const prepared = await prepareMessagesWithFiles(
			[
				{ from: "user", content: "x".repeat(450_000) },
				{
					from: "assistant",
					content: "",
					updates: [
						callUpdate("done1", "create_repo", { name: "repo" }),
						resultUpdate("done1", "create_repo", "created pngwn/repo"),
						callUpdate("dangling", "hf_jobs", { command: "run" }),
					],
				},
				{ from: "user", content: "Your previous turn failed partway through. Continue." },
			],
			imageProcessor,
			false,
			{ replayToolHistory: true }
		);
		const toolMessages = prepared.filter((m) => m.role === "tool");
		expect(toolMessages).toHaveLength(2);
		expect(String(toolMessages[0]?.content)).toContain("created pngwn/repo");
		expect(String(toolMessages[1]?.content)).toBe(
			"Error: interrupted before a result was recorded"
		);
		expect(prepared.at(-1)?.role).toBe("user");
	});

	describe("context-aware budget", () => {
		// ~80k of replay: comfortably inside the 100k ceiling, but more than a
		// 32k-token window can take once the reserve is held back.
		const bigTurn: EndpointMessage = {
			from: "assistant",
			content: "done",
			updates: Array.from({ length: 10 }, (_, i) => [
				callUpdate(`c${i}`, "search", { q: String(i) }),
				resultUpdate(`c${i}`, "search", "x".repeat(8000)),
			]).flat(),
		};
		const messages: EndpointMessage[] = [bigTurn, { from: "user", content: "next" }];
		const toolCount = async (contextLengthTokens?: number) =>
			(
				await prepareMessagesWithFiles(messages, imageProcessor, false, {
					replayToolHistory: true,
					contextLengthTokens,
				})
			).filter((m) => m.role === "tool").length;

		it("replays fully on a large window", async () => {
			expect(await toolCount(1_048_576)).toBe(10);
		});

		it("keeps the flat ceiling when no window is reported", async () => {
			// Self-hosted backends and routers that omit context_length must behave
			// exactly as they did before models reported one.
			expect(await toolCount(undefined)).toBe(10);
		});

		it("degrades on a window too small for the expansion", async () => {
			// The regression this closes: the flat history fits this model, and
			// before the budget knew the window, replay would expand it past what
			// the model accepts and the request would 400.
			expect(await toolCount(32_768)).toBe(0);
		});

		it("reserves the model's configured reply allowance, not a constant", async () => {
			// A 128k window whose model is configured to emit up to 98304 tokens has
			// room for this history OR that reply, not both. Reserving a flat
			// constant grants the full ceiling and overflows once generation starts;
			// reserving the real allowance leaves ~28k tokens for history, which
			// this turn exceeds.
			const turn: EndpointMessage = {
				from: "assistant",
				content: "done",
				updates: Array.from({ length: 12 }, (_, i) => [
					callUpdate(`b${i}`, "search", { q: String(i) }),
					resultUpdate(`b${i}`, "search", "x".repeat(8000)),
				]).flat(),
			};
			const history: EndpointMessage[] = [turn, { from: "user", content: "next" }];
			const replayed = async (maxOutputTokens?: number) =>
				(
					await prepareMessagesWithFiles(history, imageProcessor, false, {
						replayToolHistory: true,
						contextLengthTokens: 131_072,
						maxOutputTokens,
					})
				).filter((m) => m.role === "tool").length;

			expect(await replayed(undefined)).toBe(12);
			expect(await replayed(98_304)).toBe(0);
		});

		it("fits the newest turn beside the flat floor when the window is real", async () => {
			// Codex review: ~60k of flat floor plus an ~80k replay upgrade passed a
			// ~96k window budget, because the newest-turn exemption judged the
			// upgrade against the whole budget — sending ~140k characters the
			// provider rejects outright, failing the turn. Against a real window
			// the newest turn must fit beside the floor; the ballast exemption is
			// soft-ceiling only (see the ballast test above).
			const ballasted: EndpointMessage[] = [
				{ from: "user", content: "y".repeat(60_000) },
				bigTurn,
				{ from: "user", content: "next" },
			];
			const replayedTools = async (contextLengthTokens?: number) =>
				(
					await prepareMessagesWithFiles(ballasted, imageProcessor, false, {
						replayToolHistory: true,
						contextLengthTokens,
					})
				).filter((m) => m.role === "tool").length;

			// Room for floor and replay together: the transcript survives.
			expect(await replayedTools(131_072)).toBe(10);
			// The upgrade alone fits the ~96k budget, floor + upgrade does not:
			// degrade rather than send a request the model cannot accept.
			expect(await replayedTools(40_000)).toBe(0);
			// No window reported: the soft-ceiling ballast exemption still holds.
			expect(await replayedTools(undefined)).toBe(10);
		});

		it("sends the pre-replay shape when the window is smaller than the reserve", async () => {
			const prepared = await prepareMessagesWithFiles(messages, imageProcessor, false, {
				replayToolHistory: true,
				contextLengthTokens: 4_096,
			});
			expect(prepared.filter((m) => m.role === "tool")).toHaveLength(0);
			expect(prepared).toEqual([
				{ role: "assistant", content: "done" },
				{ role: "user", content: "next" },
			]);
		});
	});

	it("charges an image a nominal size rather than its encoded length", async () => {
		// A data URL runs to hundreds of thousands of characters. Charging that
		// would let one attachment flatten every replayable turn behind it, even
		// though the image itself costs the model ~a thousand tokens.
		const bigImage = "data:image/png;base64," + "A".repeat(400_000);
		const processor = (async () => ({
			mime: "image/png",
			image: { toString: () => "A".repeat(400_000) },
		})) as unknown as ReturnType<typeof makeImageProcessor>;

		const prepared = await prepareMessagesWithFiles(
			[
				{
					from: "user",
					content: "look",
					files: [{ type: "base64", name: "a.png", value: bigImage, mime: "image/png" }],
				},
				{
					from: "assistant",
					content: "done",
					updates: [callUpdate("c1", "search", { q: "x" }), resultUpdate("c1", "search", "result")],
				},
				{ from: "user", content: "next" },
			],
			processor,
			true,
			{ replayToolHistory: true }
		);

		expect(prepared.filter((m) => m.role === "tool")).toHaveLength(1);
	});

	it("dedups a round preamble persisted with leading whitespace", async () => {
		// The pre-tool stream often starts with newlines after a think block; a
		// Call update persisted untrimmed must still match the trim-normalized
		// visible text, or the preamble replays twice.
		const messages: EndpointMessage[] = [
			{
				from: "assistant",
				content: "<think>plan</think>\n\nLet me check that.\n\nHere is the answer.",
				updates: [
					{
						...callUpdate("u1", "get_weather", { city: "Paris" }),
						reasoning: "plan",
						content: "\n\nLet me check that.",
					},
					resultUpdate("u1", "get_weather", "18°C"),
				],
			},
		];
		const prepared = await prepareMessagesWithFiles(messages, imageProcessor, false, {
			replayToolHistory: true,
		});
		const roundMessage = prepared[0] as { content?: string };
		const finalMessage = prepared.at(-1) as { content?: string };
		expect(roundMessage.content).toBe("Let me check that.");
		expect(finalMessage.content).toContain("Here is the answer.");
		expect(finalMessage.content).not.toContain("Let me check that.");
	});

	it("re-attaches persisted round reasoning to its own tool-call message", async () => {
		const messages: EndpointMessage[] = [
			{
				from: "assistant",
				content:
					"<think>round one reasoning</think><think>final reasoning</think>It is 18°C in Paris.",
				updates: [
					{
						...callUpdate("u1", "get_weather", { city: "Paris" }),
						reasoning: "round one reasoning",
					},
					resultUpdate("u1", "get_weather", "18°C"),
				],
			},
		];
		const prepared = await prepareMessagesWithFiles(messages, imageProcessor, false, {
			replayToolHistory: true,
		});
		expect(prepared).toEqual([
			{
				role: "assistant",
				tool_calls: [
					{
						id: "u10000000",
						type: "function",
						function: { name: "get_weather", arguments: '{"city":"Paris"}' },
					},
				],
				reasoning_content: "round one reasoning",
			},
			{ role: "tool", tool_call_id: "u10000000", content: "18°C" },
			{
				role: "assistant",
				content: "It is 18°C in Paris.",
				reasoning_content: "final reasoning",
			},
		]);
	});

	it("does not delete an unrelated final reasoning block during round dedup, only the positionally-matching one", async () => {
		// The round's persisted reasoning ("Need weather forecast") doesn't
		// exactly match either extracted <think> block, so exact match misses.
		// It DOES contain "Need weather" (the round's own, positionally-first,
		// mismatched-by-formatting block) as a substring, but it also contains
		// "weather" (the unrelated final block) as a substring — only the first
		// must be removed; the final block must survive.
		const messages: EndpointMessage[] = [
			{
				from: "assistant",
				content: "<think>Need weather</think><think>weather</think>Final text.",
				updates: [
					{
						...callUpdate("u1", "get_weather", { city: "Paris" }),
						reasoning: "Need weather forecast",
					},
					resultUpdate("u1", "get_weather", "18°C"),
				],
			},
		];
		const prepared = await prepareMessagesWithFiles(messages, imageProcessor, false, {
			replayToolHistory: true,
		});
		const finalMessage = prepared.at(-1) as { content?: string; reasoning_content?: string };
		expect(finalMessage.content).toBe("Final text.");
		expect(finalMessage.reasoning_content).toBe("weather");
	});

	it("never expands an older turn when a newer turn already fell back to flat", async () => {
		// The newest turn alone exceeds the whole 400k ceiling — the one case
		// that may degrade it — so it goes flat; the older turn must then go
		// flat too, even though it would fit on its own.
		const turn = (prefix: string, calls: number): EndpointMessage => ({
			from: "assistant",
			content: `${prefix} done`,
			updates: Array.from({ length: calls }, (_, i) => [
				callUpdate(`${prefix}${i}`, "search", { q: String(i) }),
				resultUpdate(`${prefix}${i}`, "search", "x".repeat(8000)),
			]).flat(),
		});
		const messages: EndpointMessage[] = [
			turn("old", 2),
			{ from: "user", content: "next" },
			turn("new", 60),
		];
		const prepared = await prepareMessagesWithFiles(messages, imageProcessor, false, {
			replayToolHistory: true,
		});
		expect(prepared).toEqual([
			{ role: "assistant", content: "old done" },
			{ role: "user", content: "next" },
			{ role: "assistant", content: "new done" },
		]);
	});

	it("omits an empty flat fallback once the budget is exhausted", async () => {
		// The newest turn alone exceeds the budget, forcing every turn flat;
		// the older turn was interrupted before any visible text, so its flat
		// shape would be {role: assistant, content: ""} — it must be omitted
		// like the replay and plain branches already do, not emitted.
		const interrupted: EndpointMessage = {
			from: "assistant",
			content: "",
			updates: [callUpdate("i1", "search", { q: "x" })],
		};
		const huge: EndpointMessage = {
			from: "assistant",
			content: "new done",
			updates: Array.from({ length: 60 }, (_, i) => [
				callUpdate(`new${i}`, "search", { q: String(i) }),
				resultUpdate(`new${i}`, "search", "x".repeat(8000)),
			]).flat(),
		};
		const messages: EndpointMessage[] = [interrupted, { from: "user", content: "next" }, huge];
		const prepared = await prepareMessagesWithFiles(messages, imageProcessor, false, {
			replayToolHistory: true,
		});
		expect(prepared).toEqual([
			{ role: "user", content: "next" },
			{ role: "assistant", content: "new done" },
		]);
	});

	it("does not pull final-answer text matching an unstreamed preamble before the tools", async () => {
		// A preamble persisted on the Call update but never merged into stored
		// content (it arrived in the same delta as the first tool_calls entry)
		// is not a prefix of the visible text. Identical text inside the final
		// answer must stay where it is — mild duplication is acceptable,
		// reordering the conversation is not.
		const messages: EndpointMessage[] = [
			{
				from: "assistant",
				content: "The answer is 42. Let me check. Done.",
				updates: [
					{ ...callUpdate("u1", "search", { q: "x" }), content: "Let me check." },
					resultUpdate("u1", "search", "42"),
				],
			},
		];
		const prepared = await prepareMessagesWithFiles(messages, imageProcessor, false, {
			replayToolHistory: true,
		});
		expect(prepared[0]).toMatchObject({ role: "assistant", content: "Let me check." });
		expect(prepared.at(-1)).toEqual({
			role: "assistant",
			content: "The answer is 42. Let me check. Done.",
		});
	});

	it("attachReasoning splits reasoning out but never emits tool messages", async () => {
		const messages: EndpointMessage[] = [
			{ from: "user", content: "hi" },
			{
				from: "assistant",
				content: "<think>inline part</think>final answer",
				reasoning: "stored part",
				updates: [
					callUpdate("u1", "get_weather", { city: "Paris" }),
					resultUpdate("u1", "get_weather", "18°C"),
				],
			},
		];
		const prepared = await prepareMessagesWithFiles(messages, imageProcessor, false, {
			attachReasoning: true,
		});
		expect(prepared).toEqual([
			{ role: "user", content: "hi" },
			{
				role: "assistant",
				content: "final answer",
				reasoning_content: "stored part\ninline part",
			},
		]);
	});

	it("attachReasoning leaves assistant turns without reasoning untouched", async () => {
		const messages: EndpointMessage[] = [{ from: "assistant", content: "plain answer" }];
		const prepared = await prepareMessagesWithFiles(messages, imageProcessor, false, {
			attachReasoning: true,
		});
		expect(prepared).toEqual([{ role: "assistant", content: "plain answer" }]);
		expect("reasoning_content" in prepared[0]).toBe(false);
	});

	it("omits an interrupted reasoning-only turn entirely when attachReasoning is off, instead of a phantom empty message", async () => {
		// content is only a think block (no visible text ever streamed) and
		// attachReasoning is false, so wantsReasoning is false: the plain
		// {role: assistant, content: visible} path would otherwise emit an
		// empty-content message with nothing else attached.
		const messages: EndpointMessage[] = [
			{ from: "user", content: "hi" },
			{ from: "assistant", content: "<think>only reasoning, no answer</think>" },
		];
		const prepared = await prepareMessagesWithFiles(messages, imageProcessor, false, {
			attachReasoning: false,
		});
		expect(prepared).toEqual([{ role: "user", content: "hi" }]);
	});

	it("attachReasoning spends the same replay budget, oldest turns first, without leaking <think> in the fallback", async () => {
		// Two turns of ~250k reasoning exceed the 400k budget: the newest keeps
		// reasoning_content, the oldest falls back to a <think>-stripped flat
		// shape (not the raw string) so models that must never see historical
		// thoughts (e.g. Gemma) don't get them just because the budget ran out.
		const bigReasoningTurn = (n: number): EndpointMessage => ({
			from: "assistant",
			content: `<think>${"x".repeat(250_000)}</think>answer ${n}`,
		});
		const messages: EndpointMessage[] = [bigReasoningTurn(1), bigReasoningTurn(2)];
		const prepared = await prepareMessagesWithFiles(messages, imageProcessor, false, {
			attachReasoning: true,
		});
		expect("reasoning_content" in prepared[0]).toBe(false);
		expect(prepared[0]).toEqual({ role: "assistant", content: "answer 1" });
		expect(prepared[1]).toMatchObject({ role: "assistant", content: "answer 2" });
		expect("reasoning_content" in prepared[1]).toBe(true);
	});

	it("replayToolHistory with attachReasoning disabled keeps tool pairs but drops reasoning", async () => {
		const messages: EndpointMessage[] = [
			{
				from: "assistant",
				content: "<think>secret chain</think>done",
				updates: [callUpdate("u1", "search", { q: "x" }), resultUpdate("u1", "search", "res")],
			},
		];
		const prepared = await prepareMessagesWithFiles(messages, imageProcessor, false, {
			replayToolHistory: true,
			attachReasoning: false,
		});
		expect(prepared.filter((m) => m.role === "tool")).toHaveLength(1);
		expect(prepared.at(-1)).toEqual({ role: "assistant", content: "done" });
	});

	it("keeps reasoning bytes exact (no trimming) while still dropping whitespace-only parts", async () => {
		const messages: EndpointMessage[] = [
			{
				from: "assistant",
				content: "<think>  leading and trailing space  </think><think>   </think>done",
				updates: [],
			},
		];
		const prepared = await prepareMessagesWithFiles(messages, imageProcessor, false, {
			replayToolHistory: true,
		});
		// the whitespace-only second block is dropped, but the first block's
		// surrounding spaces survive verbatim in the echoed value
		expect(prepared).toEqual([
			{
				role: "assistant",
				content: "done",
				reasoning_content: "  leading and trailing space  ",
			},
		]);
	});

	it("keeps a round's preamble text on its own tool-call message instead of the final answer", async () => {
		const messages: EndpointMessage[] = [
			{
				from: "assistant",
				// message.content is purely the model's own streamed tokens (round
				// preamble(s) + final answer), never the tool's own output text.
				content: "Let me check that.It is 18°C and sunny in Paris.",
				updates: [
					{
						...callUpdate("u1", "get_weather", { city: "Paris" }),
						content: "Let me check that.",
					},
					resultUpdate("u1", "get_weather", "18°C, sunny"),
				],
			},
		];
		const prepared = await prepareMessagesWithFiles(messages, imageProcessor, false, {
			replayToolHistory: true,
		});
		expect(prepared).toEqual([
			{
				role: "assistant",
				tool_calls: [
					{
						id: "u10000000",
						type: "function",
						function: { name: "get_weather", arguments: '{"city":"Paris"}' },
					},
				],
				content: "Let me check that.",
			},
			{ role: "tool", tool_call_id: "u10000000", content: "18°C, sunny" },
			{ role: "assistant", content: "It is 18°C and sunny in Paris." },
		]);
	});

	it("omits content on the tool-call message when no preamble was persisted (pre-existing messages)", async () => {
		const messages: EndpointMessage[] = [
			{
				from: "assistant",
				content: "It is 18°C and sunny in Paris.",
				updates: [
					callUpdate("u1", "get_weather", { city: "Paris" }),
					resultUpdate("u1", "get_weather", "18°C"),
				],
			},
		];
		const prepared = await prepareMessagesWithFiles(messages, imageProcessor, false, {
			replayToolHistory: true,
		});
		const toolCallMsg = prepared.find((m) => "tool_calls" in m);
		expect(toolCallMsg && "content" in toolCallMsg).toBe(false);
	});

	it("strips <think> from the replayToolHistory budget fallback instead of leaking it raw", async () => {
		const bigTurn = (n: number): EndpointMessage => ({
			from: "assistant",
			content: `<think>${"x".repeat(250_000)}</think>answer ${n}`,
			updates: [
				callUpdate(`c${n}`, "search", { q: String(n) }),
				resultUpdate(`c${n}`, "search", "x".repeat(60_000)),
			],
		});
		const messages: EndpointMessage[] = [bigTurn(1), bigTurn(2)];
		const prepared = await prepareMessagesWithFiles(messages, imageProcessor, false, {
			replayToolHistory: true,
		});
		// turn 1 (oldest) fell back to flat because turn 2 alone (~258k of
		// reasoning + capped tool output) already spends most of the 400k
		// budget: it must be plain content with no reasoning_content leaking
		// through, and no raw <think> tag either.
		const flatCandidates = prepared.filter(
			(m) => m.role === "assistant" && !("tool_calls" in m) && !("reasoning_content" in m)
		);
		expect(flatCandidates).toHaveLength(1);
		expect(flatCandidates[0].content).toBe("answer 1");
		expect(flatCandidates[0].content).not.toContain("<think>");
	});

	it("attaches persisted message.reasoning alongside extracted think blocks", async () => {
		const messages: EndpointMessage[] = [
			{
				from: "assistant",
				content: "<think>inline part</think>final answer",
				reasoning: "stored part",
				updates: [],
			},
		];
		const prepared = await prepareMessagesWithFiles(messages, imageProcessor, false, {
			replayToolHistory: true,
		});
		expect(prepared).toEqual([
			{
				role: "assistant",
				content: "final answer",
				reasoning_content: "stored part\ninline part",
			},
		]);
	});

	it("strips historical <think> content even with attachReasoning disabled (Gemma-style models)", async () => {
		// Some vendors (Gemma) document that historical thoughts must be
		// stripped across completed turns. Previously, attachReasoning:false
		// fell through to raw message.content, leaking inline <think> text.
		const messages: EndpointMessage[] = [
			{ from: "assistant", content: "<think>private prior thought</think>Final answer" },
		];
		const prepared = await prepareMessagesWithFiles(messages, imageProcessor, false, {
			attachReasoning: false,
		});
		expect(prepared).toEqual([{ role: "assistant", content: "Final answer" }]);
	});

	it("strips historical <think> content with no options passed at all", async () => {
		const messages: EndpointMessage[] = [
			{ from: "assistant", content: "<think>thought</think>done" },
		];
		const prepared = await prepareMessagesWithFiles(messages, imageProcessor, false);
		expect(prepared).toEqual([{ role: "assistant", content: "done" }]);
	});

	it("strips an empty <think></think> block even when nothing survives to attach as reasoning", async () => {
		const messages: EndpointMessage[] = [{ from: "assistant", content: "<think></think>Hello" }];
		const prepared = await prepareMessagesWithFiles(messages, imageProcessor, false, {
			attachReasoning: true,
		});
		expect(prepared).toEqual([{ role: "assistant", content: "Hello" }]);
	});

	it("suppresses reasoning_content for a message produced by a different router-resolved model", async () => {
		// Under the "omni" router alias, each turn can be produced by a
		// different model. Reasoning is conditioned on its own producer, so a
		// message routed to model A must not have its reasoning replayed when
		// the current turn targets model B.
		const messages: EndpointMessage[] = [
			{
				from: "assistant",
				content: "<think>model A's private reasoning</think>answer from A",
				routerMetadata: { route: "r", model: "model-a" },
			},
		];
		const suppressed = await prepareMessagesWithFiles(messages, imageProcessor, false, {
			attachReasoning: true,
			currentProducerModel: "model-b",
		});
		expect(suppressed).toEqual([{ role: "assistant", content: "answer from A" }]);

		const allowed = await prepareMessagesWithFiles(messages, imageProcessor, false, {
			attachReasoning: true,
			currentProducerModel: "model-a",
		});
		expect(allowed).toEqual([
			{
				role: "assistant",
				content: "answer from A",
				reasoning_content: "model A's private reasoning",
			},
		]);
	});

	it("treats a message with no routerMetadata as same-producer (the common pinned-model case)", async () => {
		const messages: EndpointMessage[] = [
			{ from: "assistant", content: "<think>reasoning</think>answer" },
		];
		const prepared = await prepareMessagesWithFiles(messages, imageProcessor, false, {
			attachReasoning: true,
			currentProducerModel: "any-model",
		});
		expect(prepared).toEqual([
			{ role: "assistant", content: "answer", reasoning_content: "reasoning" },
		]);
	});

	it("gates replayed tool-round reasoning by producer, but always replays tool calls/results", async () => {
		const messages: EndpointMessage[] = [
			{
				from: "assistant",
				content: "done",
				routerMetadata: { route: "r", model: "model-a" },
				updates: [
					{
						...callUpdate("u1", "get_weather", { city: "Paris" }),
						reasoning: "model A reasoning",
					},
					resultUpdate("u1", "get_weather", "18°C"),
				],
			},
		];
		const prepared = await prepareMessagesWithFiles(messages, imageProcessor, false, {
			replayToolHistory: true,
			currentProducerModel: "model-b",
		});
		// Tool calls and results are protocol-neutral and always replay.
		expect(prepared).toEqual([
			{
				role: "assistant",
				tool_calls: [
					{
						id: "u10000000",
						type: "function",
						function: { name: "get_weather", arguments: '{"city":"Paris"}' },
					},
				],
			},
			{ role: "tool", tool_call_id: "u10000000", content: "18°C" },
			{ role: "assistant", content: "done" },
		]);
		// No reasoning_content anywhere, since the producer doesn't match.
		expect(prepared.some((m) => "reasoning_content" in m)).toBe(false);
	});

	it("replays the persisted raw arguments string instead of reserializing sanitized parameters", async () => {
		const messages: EndpointMessage[] = [
			{
				from: "assistant",
				content: "done",
				updates: [
					{
						...callUpdate("u1", "search", { query: "x" }),
						argumentsRaw: '{"query":{"city":"Paris","units":"metric"},"images":["image_1"]}',
					},
					resultUpdate("u1", "search", "res"),
				],
			},
		];
		const prepared = await prepareMessagesWithFiles(messages, imageProcessor, false, {
			replayToolHistory: true,
		});
		const callMessage = prepared[0] as { tool_calls?: Array<{ function: { arguments: string } }> };
		expect(callMessage.tool_calls?.[0]?.function.arguments).toBe(
			'{"query":{"city":"Paris","units":"metric"},"images":["image_1"]}'
		);
	});

	it("falls back to sanitized parameters when argumentsRaw was not persisted (legacy messages)", async () => {
		const messages: EndpointMessage[] = [
			{
				from: "assistant",
				content: "done",
				updates: [callUpdate("u1", "search", { q: "x" }), resultUpdate("u1", "search", "res")],
			},
		];
		const prepared = await prepareMessagesWithFiles(messages, imageProcessor, false, {
			replayToolHistory: true,
		});
		const callMessage = prepared[0] as { tool_calls?: Array<{ function: { arguments: string } }> };
		expect(callMessage.tool_calls?.[0]?.function.arguments).toBe('{"q":"x"}');
	});

	it("falls back to sanitized parameters when a persisted argumentsRaw is not valid JSON", async () => {
		// toolInvocation.ts already guards this at write time, but replay must
		// never trust a persisted argumentsRaw blindly at its own read
		// boundary — defense in depth against a future write path or
		// otherwise-corrupted data. Invalid JSON here must never reach the
		// outgoing tool_calls.function.arguments, since a provider that
		// validates that field could reject the whole continuation.
		const messages: EndpointMessage[] = [
			{
				from: "assistant",
				content: "done",
				updates: [
					{ ...callUpdate("u1", "search", { q: "x" }), argumentsRaw: '{"q":"unterminated' },
					resultUpdate("u1", "search", "res"),
				],
			},
		];
		const prepared = await prepareMessagesWithFiles(messages, imageProcessor, false, {
			replayToolHistory: true,
		});
		const callMessage = prepared[0] as { tool_calls?: Array<{ function: { arguments: string } }> };
		expect(callMessage.tool_calls?.[0]?.function.arguments).toBe('{"q":"x"}');
		expect(() => JSON.parse(callMessage.tool_calls?.[0]?.function.arguments ?? "")).not.toThrow();
	});

	it("falls back to sanitized parameters when a persisted argumentsRaw is valid JSON but not an object", async () => {
		const messages: EndpointMessage[] = [
			{
				from: "assistant",
				content: "done",
				updates: [
					{ ...callUpdate("u1", "search", { q: "x" }), argumentsRaw: "[1,2,3]" },
					resultUpdate("u1", "search", "res"),
				],
			},
		];
		const prepared = await prepareMessagesWithFiles(messages, imageProcessor, false, {
			replayToolHistory: true,
		});
		const callMessage = prepared[0] as { tool_calls?: Array<{ function: { arguments: string } }> };
		expect(callMessage.tool_calls?.[0]?.function.arguments).toBe('{"q":"x"}');
	});

	it("still emits the normalized tool_call_id even when the original provider id is persisted", async () => {
		const messages: EndpointMessage[] = [
			{
				from: "assistant",
				content: "done",
				updates: [
					{ ...callUpdate("u1", "search", { q: "x" }), originalId: "call_abc123XYZ" },
					resultUpdate("u1", "search", "res"),
				],
			},
		];
		const prepared = await prepareMessagesWithFiles(messages, imageProcessor, false, {
			replayToolHistory: true,
		});
		const callMessage = prepared[0] as { tool_calls?: Array<{ id: string }> };
		expect(callMessage.tool_calls?.[0]?.id).toBe("u10000000");
	});
});

type Sent = OpenAI.Chat.Completions.ChatCompletionMessageParam;

const user = (id: string, content: string): HistoryMessage => ({ id, from: "user", content });

const toolTurn = (
	id: string,
	rounds: number,
	outputChars: number,
	output: (round: number) => string = () => ""
): HistoryMessage => ({
	id,
	from: "assistant",
	content: `${id} done`,
	updates: Array.from({ length: rounds }, (_, i) => [
		callUpdate(`${id}r${i}`, "search", { q: String(i) }),
		resultUpdate(`${id}r${i}`, "search", output(i).padEnd(outputChars, "x")),
	]).flat(),
});

const windowOptions = {
	replayToolHistory: true,
	contextLengthTokens: 1_048_576,
	slidingWindow: true,
} as const;

async function unitsOf(messages: HistoryMessage[]): Promise<HistoryUnit[]> {
	const history = await prepareHistory(messages, imageProcessor, false, windowOptions);
	if (!history.units) throw new Error("expected the sliding window to apply");
	return history.units;
}

function expectPaired(messages: Sent[]) {
	const open = new Set<string>();
	for (const message of messages) {
		if (message.role === "tool") {
			expect(open.has(message.tool_call_id)).toBe(true);
			open.delete(message.tool_call_id);
			continue;
		}
		expect(open.size).toBe(0);
		if (message.role === "assistant") message.tool_calls?.forEach((call) => open.add(call.id));
	}
	expect(open.size).toBe(0);
}

const textOf = (message: Sent | undefined) =>
	typeof message?.content === "string" ? message.content : JSON.stringify(message?.content);

describe("sliding history window", () => {
	const longRun = () =>
		Array.from({ length: 5 }, (_, t) => [
			user(`u${t}`, `ask ${t}`),
			toolTurn(`a${t}`, 12, 30_000),
		]).flat();

	it("replays every turn whole and every output uncapped while the request fits the window", async () => {
		const prepared = await prepareMessagesWithFiles(
			longRun(),
			imageProcessor,
			false,
			windowOptions
		);
		const tools = prepared.filter((m) => m.role === "tool");
		expect(tools).toHaveLength(60);
		expect(tools.every((m) => textOf(m).length === 30_000)).toBe(true);
		expect(prepared.filter((m) => m.role === "user")).toHaveLength(5);
	});

	it("restores the legacy budget and per-output cap when the flag is off", async () => {
		const prepared = await prepareMessagesWithFiles(longRun(), imageProcessor, false, {
			...windowOptions,
			slidingWindow: false,
		});
		const tools = prepared.filter((m) => m.role === "tool");
		expect(tools.length).toBeGreaterThan(0);
		expect(tools.length).toBeLessThan(60);
		expect(textOf(tools[0])).toBe("x".repeat(8000) + "\n[...truncated]");
		expect(prepared[1]).toEqual({ role: "assistant", content: "a0 done" });
	});

	it("keeps the legacy budget for a model that reports no window", async () => {
		const options = { replayToolHistory: true, slidingWindow: true } as const;
		const withFlag = await prepareMessagesWithFiles(longRun(), imageProcessor, false, options);
		const legacy = await prepareMessagesWithFiles(longRun(), imageProcessor, false, {
			...options,
			slidingWindow: false,
		});
		expect(withFlag).toEqual(legacy);
		expect(withFlag.filter((m) => m.role === "tool").length).toBeLessThan(60);
	});

	it("never separates a tool result from its call, whatever the limit", async () => {
		const parallel: HistoryMessage = {
			id: "a0",
			from: "assistant",
			content: "a0 done",
			updates: Array.from({ length: 4 }, (_, i) => [
				callUpdate(`p${i}a`, "search", { q: "a" }),
				callUpdate(`p${i}b`, "search", { q: "b" }),
				resultUpdate(`p${i}a`, "search", "y".repeat(5_000)),
				resultUpdate(`p${i}b`, "search", "z".repeat(5_000)),
			]).flat(),
		};
		const units = await unitsOf([
			{ id: "sys", from: "system", content: "SYSTEM" },
			user("u0", "BRIEF"),
			parallel,
			user("u1", "more"),
			toolTurn("a1", 6, 5_000),
			user("u2", "LIVE"),
			toolTurn("a2", 5, 5_000),
		]);
		for (let limitChars = 0; limitChars <= 200_000; limitChars += 4_000) {
			const sent = renderWindow(units, planWindow(units, { limitChars, fixedChars: 0 }));
			expectPaired(sent);
			expect(sent[0]).toEqual({ role: "system", content: "SYSTEM" });
			expect(textOf(sent[1])).toContain("BRIEF");
			expect(sent.some((m) => m.role === "user" && textOf(m).includes("LIVE"))).toBe(true);
		}
	});

	it("keeps the system prompt, the brief and answered questions, and marks the gap", async () => {
		const units = await unitsOf([
			{ id: "sys", from: "system", content: "SYSTEM" },
			user("u0", "BRIEF"),
			{
				id: "a0",
				from: "assistant",
				content: "Asked.",
				updates: [
					callUpdate("q1", "ask_user_question", {}),
					resultUpdate("q1", "ask_user_question", "ANSWER: use LoRA"),
				],
			},
			user("u1", "next"),
			toolTurn("a1", 10, 10_000, (i) => `OLD${i}`),
			user("u2", "LIVE"),
		]);
		const plan = planWindow(units, { limitChars: 40_000, fixedChars: 0 });
		expect(plan.moved).toBe(true);
		const sent = renderWindow(units, plan);
		expectPaired(sent);
		expect(sent[0]).toEqual({ role: "system", content: "SYSTEM" });
		expect(textOf(sent[1])).toMatch(/^BRIEF\n\n\[Earlier history omitted: /);
		const question = sent.find((m) => m.role === "assistant" && m.tool_calls);
		expect(question?.role === "assistant" && question.tool_calls?.[0]?.function.name).toBe(
			"ask_user_question"
		);
		expect(sent.some((m) => m.role === "tool" && textOf(m) === "ANSWER: use LoRA")).toBe(true);
		expect(JSON.stringify(sent)).not.toContain("OLD0");
		expect(JSON.stringify(sent)).not.toContain("Asked.");
		expect(sent.at(-1)).toEqual({ role: "user", content: "LIVE" });
	});

	it("counts what it dropped and folds the brief into the next user message", async () => {
		const units = await unitsOf([
			user("u0", "BRIEF"),
			toolTurn("a0", 3, 1_000),
			user("u1", "second"),
			toolTurn("a1", 3, 1_000),
			user("u2", "third"),
			toolTurn("a2", 3, 1_000),
			user("u3", "fourth"),
		]);
		const plan = planWindow(units, {
			limitChars: 1_000_000,
			fixedChars: 0,
			stored: { messageId: "u2", round: 0 },
		});
		expect(plan.moved).toBe(false);
		const sent = renderWindow(units, plan);
		expect(sent[0]).toEqual({
			role: "user",
			content: `BRIEF\n\n${omittedMarker(1, 6)}\n\nthird`,
		});
		expect(sent.filter((m) => m.role === "tool")).toHaveLength(3);
		sent.forEach((m, i) => expect(m.role === "user" && sent[i + 1]?.role === "user").toBe(false));
	});

	it("slides inside a monster live turn by rounds, never flattening it", async () => {
		const live: HistoryMessage = { ...toolTurn("a1", 60, 20_000, (i) => `R${i}:`), content: "" };
		const units = await unitsOf([
			user("u0", "BRIEF"),
			toolTurn("a0", 1, 1_000),
			user("u1", "GO"),
			live,
		]);
		const limitChars = 400_000;
		const plan = planWindow(units, { limitChars, fixedChars: 0 });
		expect(plan.moved).toBe(true);
		expect(plan.chars).toBeLessThanOrEqual(limitChars / 2);
		const sent = renderWindow(units, plan);
		expectPaired(sent);
		expect(textOf(sent[0])).toMatch(
			/^BRIEF\n\n\[Earlier history omitted: 0 turns \/ \d+ tool rounds\.[^\]]*\]\n\nGO$/
		);
		const kept = sent.filter((m) => m.role === "tool").map((m) => textOf(m).split(":")[0]);
		const newest = Array.from({ length: kept.length }, (_, i) => `R${60 - kept.length + i}`);
		expect(kept).toEqual(newest);
		expect(kept.length).toBeGreaterThan(0);
		expect(sent.filter((m) => m.role === "tool").every((m) => textOf(m).length === 20_000)).toBe(
			true
		);
		expect(sent.filter((m) => m.role === "assistant").every((m) => m.tool_calls)).toBe(true);
	});

	describe("the stored start", () => {
		const limitChars = 200_000;
		const growing = (rounds: number) =>
			unitsOf([user("u0", "BRIEF"), toolTurn("a0", rounds, 10_000)]);

		it("holds until a request passes the trigger, then jumps to about half the limit", async () => {
			const underTrigger = planWindow(await growing(14), { limitChars, fixedChars: 0 });
			expect(underTrigger).toMatchObject({ moved: false, start: undefined });

			const overTrigger = planWindow(await growing(16), { limitChars, fixedChars: 0 });
			expect(overTrigger.moved).toBe(true);
			expect(overTrigger.chars).toBeLessThanOrEqual(limitChars / 2);
			const first = overTrigger.start;
			expect(first?.messageId).toBe("a0");

			const grown = await growing(19);
			const held = planWindow(grown, { limitChars, fixedChars: 0, stored: first });
			expect(held).toMatchObject({ moved: false, start: first });
			expect(held.chars).toBeGreaterThan(limitChars / 2);
			expect(grown[held.from].start).toEqual(first);

			const next = planWindow(await growing(24), { limitChars, fixedChars: 0, stored: first });
			expect(next.moved).toBe(true);
			expect(next.start?.round).toBeGreaterThan(first?.round ?? Infinity);
			expect(next.chars).toBeLessThanOrEqual(limitChars / 2);
		});

		it("keeps and stores the start of a tool-less conversation", async () => {
			await ready;
			const conversationId = new ObjectId();
			await collections.conversations.insertOne({
				_id: conversationId,
				model: "m",
				title: "t",
				messages: [],
				createdAt: new Date(),
				updatedAt: new Date(),
			} satisfies Conversation);
			const answer = (id: string, fill: string, chars: number): HistoryMessage => ({
				id,
				from: "assistant",
				content: fill.repeat(chars),
			});
			const firstThree = [
				user("u0", "One?"),
				answer("a0", "a", 250_000),
				user("u1", "Two?"),
				answer("a1", "b", 250_000),
				user("u2", "Three?"),
				answer("a2", "c", 250_000),
				user("u3", "Four?"),
			];
			const options = {
				contextLengthTokens: 262_144,
				slidingWindow: true,
				window: { conversationId },
			};
			const slid = await prepareMessagesWithFiles(firstThree, imageProcessor, false, options);
			expect(JSON.stringify(slid)).not.toContain("bbbbbbbbbb");
			const stored = (await collections.conversations.findOne({ _id: conversationId }))
				?.historyWindow;
			expect(stored).toEqual({ messageId: "u2", round: 0, limitChars: 774_144 });

			const later = [...firstThree, answer("a3", "d", 200_000), user("u4", "Five?")];
			const held = await prepareMessagesWithFiles(later, imageProcessor, false, {
				...options,
				window: { conversationId, stored },
			});
			expect(JSON.stringify(held)).toContain("cccccccccc");
			const unstored = await prepareMessagesWithFiles(later, imageProcessor, false, {
				...options,
				window: undefined,
			});
			expect(JSON.stringify(unstored)).not.toContain("cccccccccc");
			await collections.conversations.deleteOne({ _id: conversationId });
		});

		it("recomputes from the beginning when the start is not on the replayed path", async () => {
			const elsewhere = { messageId: "another-branch", round: 3 };
			const small = await growing(14);
			expect(planWindow(small, { limitChars, fixedChars: 0, stored: elsewhere })).toEqual(
				planWindow(small, { limitChars, fixedChars: 0 })
			);
			const large = await growing(16);
			expect(planWindow(large, { limitChars, fixedChars: 0, stored: elsewhere })).toEqual(
				planWindow(large, { limitChars, fixedChars: 0 })
			);
		});
	});
});

describe("harness events in replay", () => {
	const EVENT_TEXT =
		"[Harness event, not part of this tool result]\nJob sft-smoke (a10g-small) failed: ERROR after 2m17s. Read its logs with check_job before changing anything.";
	const eventUpdate = (afterToolUuid: string) =>
		({
			type: MessageUpdateType.HarnessEvent,
			events: [
				{
					serviceId: "svc",
					kind: "job",
					jobId: "0123456789abcdef01234567",
					name: "sft-smoke",
					from: "RUNNING",
					to: "ERROR",
					ranSeconds: 137,
					at: 0,
				},
			],
			text: EVENT_TEXT,
			afterToolUuid,
		}) satisfies MessageUpdate;

	const withEvent = (output = "18°C, sunny"): HistoryMessage[] => [
		user("u0", "weather and forecast?"),
		{
			id: "a0",
			from: "assistant",
			content: "Sunny all week.",
			contentShape: 2,
			updates: [
				callUpdate("w1", "get_weather", { city: "Paris" }),
				callUpdate("w2", "get_weather", { city: "Lyon" }),
				resultUpdate("w1", "get_weather", "12°C, rain"),
				resultUpdate("w2", "get_weather", output),
				eventUpdate("w2"),
				callUpdate("f1", "get_forecast", { city: "Paris" }),
				resultUpdate("f1", "get_forecast", "sunny all week"),
			],
		},
	];
	const legacyOf = (messages: HistoryMessage[]): HistoryMessage[] =>
		messages.map((m) => {
			if (m.from !== "assistant") return m;
			const legacy = { ...m };
			delete legacy.contentShape;
			return legacy;
		});

	it("appends the text to the result of the call it followed, in either stored shape", async () => {
		const rounds = await prepareMessagesWithFiles(withEvent(), imageProcessor, false, {
			replayToolHistory: true,
		});
		const legacy = await prepareMessagesWithFiles(legacyOf(withEvent()), imageProcessor, false, {
			replayToolHistory: true,
		});

		expect(rounds).toEqual(legacy);
		expect(rounds.map((m) => m.role)).toEqual([
			"user",
			"assistant",
			"tool",
			"tool",
			"assistant",
			"tool",
			"assistant",
		]);
		expect(textOf(rounds[2])).toBe("12°C, rain");
		expect(textOf(rounds[3])).toBe(`18°C, sunny\n\n${EVENT_TEXT}`);
		expect(textOf(rounds[5])).toBe("sunny all week");
	});

	it("caps the output and never the event when the legacy budget applies", async () => {
		const output = "y".repeat(9_000);
		const replayed = await prepareMessagesWithFiles(withEvent(output), imageProcessor, false, {
			replayToolHistory: true,
			slidingWindow: false,
		});

		expect(textOf(replayed[3])).toBe(`${"y".repeat(8000)}\n[...truncated]\n\n${EVENT_TEXT}`);
	});

	it("keeps the event inside its round's unit", async () => {
		const units = await unitsOf(withEvent());
		const without = await unitsOf(
			withEvent().map((m) =>
				m.from === "assistant"
					? { ...m, updates: m.updates?.filter((u) => u.type !== MessageUpdateType.HarnessEvent) }
					: m
			)
		);

		expect(units.map((unit) => unit.messages.length)).toEqual(
			without.map((unit) => unit.messages.length)
		);
		const round = units.find((unit) =>
			unit.messages.some((m) => typeof m.content === "string" && m.content.includes(EVENT_TEXT))
		);
		expect(round?.rounds).toBe(1);
		expect(round?.start).toEqual({ messageId: "a0", round: 0 });
		expect(textOf(round?.messages.at(-1))).toContain(EVENT_TEXT);
	});
});
