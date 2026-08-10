import { describe, expect, it } from "vitest";
import { prepareMessagesWithFiles } from "./prepareFiles";
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
		// Each turn carries ~7×8k of tool output, so two turns exceed the 100k
		// budget: the newest keeps its tool history, the oldest goes flat.
		const bigTurn = (prefix: string): EndpointMessage => ({
			from: "assistant",
			content: `${prefix} done`,
			updates: Array.from({ length: 7 }, (_, i) => [
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
		expect(prepared.filter((m) => m.role === "tool")).toHaveLength(7);
	});

	it("charges plain messages against the budget, so a long history leaves less room for replay", async () => {
		// One tool turn that fits the budget on its own. Preceded by a user turn
		// large enough to consume the budget by itself, it must flatten: the cap
		// covers the whole outgoing history, not just the replayed part, or a
		// conversation that already fills a context window would still be handed
		// another budget's worth on top.
		const toolTurn: EndpointMessage = {
			from: "assistant",
			content: "done",
			updates: [callUpdate("c1", "search", { q: "x" }), resultUpdate("c1", "search", "result")],
		};

		const withoutBallast = await prepareMessagesWithFiles(
			[{ from: "user", content: "hi" }, toolTurn, { from: "user", content: "next" }],
			imageProcessor,
			false,
			{ replayToolHistory: true }
		);
		expect(withoutBallast.filter((m) => m.role === "tool")).toHaveLength(1);

		const withBallast = await prepareMessagesWithFiles(
			[{ from: "user", content: "x".repeat(120_000) }, toolTurn, { from: "user", content: "next" }],
			imageProcessor,
			false,
			{ replayToolHistory: true }
		);
		expect(withBallast.filter((m) => m.role === "tool")).toHaveLength(0);
		// Degraded, never dropped — the user's own text is untouched.
		expect(withBallast.filter((m) => m.role === "user")).toHaveLength(2);
		expect(withBallast).toContainEqual({ role: "assistant", content: "done" });
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
		// The newest turn alone exceeds the 100k budget, so it goes flat; the
		// older turn must then go flat too, even though it would fit on its own.
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
			turn("new", 14),
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
			updates: Array.from({ length: 14 }, (_, i) => [
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
		// Two turns of ~60k reasoning exceed the 100k budget: the newest keeps
		// reasoning_content, the oldest falls back to a <think>-stripped flat
		// shape (not the raw string) so models that must never see historical
		// thoughts (e.g. Gemma) don't get them just because the budget ran out.
		const bigReasoningTurn = (n: number): EndpointMessage => ({
			from: "assistant",
			content: `<think>${"x".repeat(60_000)}</think>answer ${n}`,
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
			content: `<think>${"x".repeat(60_000)}</think>answer ${n}`,
			updates: [
				callUpdate(`c${n}`, "search", { q: String(n) }),
				resultUpdate(`c${n}`, "search", "x".repeat(60_000)),
			],
		});
		const messages: EndpointMessage[] = [bigTurn(1), bigTurn(2)];
		const prepared = await prepareMessagesWithFiles(messages, imageProcessor, false, {
			replayToolHistory: true,
		});
		// turn 1 (oldest) fell back to flat because turn 2 alone (~68k of
		// reasoning + capped tool output) already spends most of the 100k
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
