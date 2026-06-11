import { describe, expect, test } from "vitest";

import type { Message } from "$lib/types/Message";
import { MessageUpdateStatus, MessageUpdateType } from "$lib/types/MessageUpdate";
import {
	GENERATION_STALE_MS,
	isAssistantGenerationTerminal,
	isConversationGenerationActive,
	isGenerationStale,
} from "./generationState";

function assistantMessage(overrides: Partial<Message> = {}): Message {
	return {
		from: "assistant",
		id: "assistant-1" as Message["id"],
		content: "",
		children: [],
		...overrides,
	};
}

describe("generationState", () => {
	test("returns active when assistant has no terminal update", () => {
		const messages = [
			assistantMessage({
				updates: [{ type: MessageUpdateType.Stream, token: "Hello" }],
			}),
		];

		expect(isConversationGenerationActive(messages)).toBe(true);
	});

	test("treats final answer update as terminal", () => {
		const message = assistantMessage({
			updates: [{ type: MessageUpdateType.FinalAnswer, text: "Done", interrupted: false }],
		});

		expect(isAssistantGenerationTerminal(message)).toBe(true);
		expect(isConversationGenerationActive([message])).toBe(false);
	});

	test("treats error status update as terminal", () => {
		const message = assistantMessage({
			updates: [
				{
					type: MessageUpdateType.Status,
					status: MessageUpdateStatus.Error,
					message: "Something went wrong",
				},
			],
		});

		expect(isAssistantGenerationTerminal(message)).toBe(true);
		expect(isConversationGenerationActive([message])).toBe(false);
	});

	test("treats finished status update as terminal", () => {
		const message = assistantMessage({
			updates: [
				{
					type: MessageUpdateType.Status,
					status: MessageUpdateStatus.Finished,
				},
			],
		});

		expect(isAssistantGenerationTerminal(message)).toBe(true);
		expect(isConversationGenerationActive([message])).toBe(false);
	});

	test("treats interrupted assistant message as terminal", () => {
		const message = assistantMessage({
			interrupted: true,
			updates: [{ type: MessageUpdateType.Stream, token: "partial" }],
		});

		expect(isAssistantGenerationTerminal(message)).toBe(true);
		expect(isConversationGenerationActive([message])).toBe(false);
	});
});

describe("isGenerationStale", () => {
	test("a recent write is not stale", () => {
		expect(isGenerationStale(new Date())).toBe(false);
		expect(isGenerationStale(new Date(Date.now() - GENERATION_STALE_MS + 5_000))).toBe(false);
	});

	test("a write older than the threshold is stale", () => {
		expect(isGenerationStale(new Date(Date.now() - GENERATION_STALE_MS - 1_000))).toBe(true);
	});

	test("accepts ISO strings (API payloads)", () => {
		expect(
			isGenerationStale(new Date(Date.now() - GENERATION_STALE_MS - 1_000).toISOString())
		).toBe(true);
		expect(isGenerationStale(new Date().toISOString())).toBe(false);
	});

	test("missing or invalid timestamps are never stale", () => {
		expect(isGenerationStale(undefined)).toBe(false);
		expect(isGenerationStale("not-a-date")).toBe(false);
	});
});
