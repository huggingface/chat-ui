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
});
