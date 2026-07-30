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
						id: "u1",
						type: "function",
						function: { name: "get_weather", arguments: JSON.stringify({ city: "Paris" }) },
					},
				],
			},
			{ role: "tool", tool_call_id: "u1", content: "18°C, sunny" },
			{
				role: "assistant",
				tool_calls: [
					{
						id: "u2",
						type: "function",
						function: { name: "get_forecast", arguments: JSON.stringify({ city: "Paris" }) },
					},
				],
			},
			{ role: "tool", tool_call_id: "u2", content: "sunny all week" },
			{
				role: "assistant",
				content: "It is 18°C and sunny in Paris.",
				reasoning_content: "need the tool",
			},
		]);
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
					{ id: "a", type: "function", function: { name: "search", arguments: '{"q":"x"}' } },
					{ id: "b", type: "function", function: { name: "search", arguments: '{"q":"y"}' } },
				],
			},
			{ role: "tool", tool_call_id: "a", content: "res-a" },
			{ role: "tool", tool_call_id: "b", content: "Error: timeout" },
			{ role: "assistant", content: "done" },
		]);
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
