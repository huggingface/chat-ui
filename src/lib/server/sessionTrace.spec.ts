import { describe, expect, it } from "vitest";
import type { Message } from "$lib/types/Message";
import { MessageToolUpdateType, MessageUpdateType } from "$lib/types/MessageUpdate";
import { ToolResultStatus } from "$lib/types/Tool";
import { toSessionTrace } from "./sessionTrace";

type Trace = Parameters<typeof toSessionTrace>[0];

const at = new Date("2026-11-14T20:39:24.000Z");
const call = { name: "search", parameters: {} };

function trace(messages: Message[], overrides: Partial<Trace["conversation"]> = {}): Trace {
	return {
		format: "chat-ui-conversation-trace",
		version: 1,
		exportedAt: at,
		conversation: {
			id: "6af8c6fb0e7fdff83a215db8",
			title: "Find the paper",
			model: "test-model",
			preprompt: "",
			createdAt: at,
			updatedAt: at,
			mlAssistant: undefined,
			mlBudget: undefined,
			plan: undefined,
			historyWindow: undefined,
			rootMessageId: messages[0]?.id,
			messages,
			...overrides,
		},
		services: [],
		artefacts: [],
		agentRuns: [],
		agentCalls: [],
		sources: [],
		files: [],
		toolImages: [],
	} as Trace;
}

const lines = (jsonl: string) =>
	jsonl
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}` as Message["id"];

describe("toSessionTrace", () => {
	it("opens with the session header the Hub viewer detects", () => {
		const [header, ...rest] = lines(toSessionTrace(trace([])));
		expect(header).toMatchObject({
			type: "session",
			harness: "chat-ui",
			id: "6af8c6fb0e7fdff83a215db8",
			name: "Find the paper",
		});
		expect(rest).toEqual([]);
	});

	it("writes each tool round as a call line and a result line tied by id", () => {
		const messages: Message[] = [
			{ id: id(1), from: "system", content: "", children: [id(2)] },
			{ id: id(2), from: "user", content: "find it", createdAt: at, children: [id(3)] },
			{
				id: id(3),
				from: "assistant",
				content: "Here it is.",
				reasoning: "done",
				contentShape: 2,
				updatedAt: at,
				updates: [
					{
						type: MessageUpdateType.Tool,
						subtype: MessageToolUpdateType.Call,
						uuid: "call-1",
						call,
						content: "Let me look.",
						reasoning: "search first",
						argumentsRaw: '{"query":{"text":"attention"}}',
					},
					{
						type: MessageUpdateType.Tool,
						subtype: MessageToolUpdateType.Result,
						uuid: "call-1",
						result: { status: ToolResultStatus.Success, call, outputs: [{ text: "1706.03762" }] },
					},
				],
			},
		];
		const [, ...rest] = lines(toSessionTrace(trace(messages, { preprompt: "Be brief." })));

		expect(rest.map((line) => line.type)).toEqual(Array(5).fill("message"));
		expect(rest.map((line) => line.message)).toEqual([
			{ role: "system", content: "Be brief." },
			{ role: "user", content: "find it", timestamp: at.getTime() },
			{
				role: "assistant",
				content: "Let me look.",
				reasoningContent: "search first",
				toolCalls: [
					{
						id: "call-1",
						function: { name: "search", arguments: '{"query":{"text":"attention"}}' },
					},
				],
				timestamp: at.getTime(),
				model: "test-model",
			},
			{ role: "tool", toolCallId: "call-1", content: "1706.03762", timestamp: at.getTime() },
			{
				role: "assistant",
				content: "Here it is.",
				reasoningContent: "done",
				timestamp: at.getTime(),
				model: "test-model",
			},
		]);
	});

	it("follows the branch on screen and reports a call with no result", () => {
		const messages: Message[] = [
			{ id: id(1), from: "system", content: "", children: [id(2)] },
			{ id: id(2), from: "user", content: "go", children: [id(3), id(4)] },
			{ id: id(3), from: "assistant", content: "first try" },
			{
				id: id(4),
				from: "assistant",
				content: "<think>hm</think>",
				updates: [
					{ type: MessageUpdateType.Tool, subtype: MessageToolUpdateType.Call, uuid: "c", call },
				],
			},
		];
		const [, ...rest] = lines(toSessionTrace(trace(messages)));

		expect(rest.map((line) => [line.message.role, line.message.content])).toEqual([
			["user", "go"],
			["assistant", ""],
			["tool", "Error: interrupted before a result was recorded"],
		]);
	});
});
