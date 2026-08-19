import { describe, expect, test } from "vitest";

import type { Message } from "$lib/types/Message";
import { MessageUpdateStatus, MessageUpdateType } from "$lib/types/MessageUpdate";
import { isAssistantGenerationTerminal, isConversationGenerationActive } from "./generationState";

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

	// Edge cases that drive the streaming UI state (stop button, resume) and that
	// P3b's rewrite must preserve.

	test("an assistant message with no updates at all is non-terminal (still generating)", () => {
		// A freshly-created assistant message before any terminal marker lands.
		const message = assistantMessage({ updates: [] });
		expect(isAssistantGenerationTerminal(message)).toBe(false);
		expect(isConversationGenerationActive([message])).toBe(true);
	});

	test("an assistant message with undefined updates is non-terminal", () => {
		const message = assistantMessage({ updates: undefined });
		expect(isAssistantGenerationTerminal(message)).toBe(false);
	});

	test("a missing / non-assistant message is treated as terminal", () => {
		expect(isAssistantGenerationTerminal(undefined)).toBe(true);
		expect(
			isAssistantGenerationTerminal({
				from: "user",
				id: "u1" as Message["id"],
				content: "hi",
				children: [],
			})
		).toBe(true);
	});

	test("an empty conversation is not active", () => {
		expect(isConversationGenerationActive([])).toBe(false);
	});

	test("a conversation with no assistant message is not active", () => {
		expect(
			isConversationGenerationActive([
				{ from: "user", id: "u1" as Message["id"], content: "hi", children: [] },
			])
		).toBe(false);
	});

	test("activeness is decided by the LAST assistant message, not an earlier one", () => {
		const earlierDone = assistantMessage({
			id: "a1" as Message["id"],
			updates: [{ type: MessageUpdateType.Status, status: MessageUpdateStatus.Finished }],
		});
		const latestRunning = assistantMessage({
			id: "a2" as Message["id"],
			updates: [{ type: MessageUpdateType.Stream, token: "still going" }],
		});
		expect(isConversationGenerationActive([earlierDone, latestRunning])).toBe(true);

		const latestDone = assistantMessage({
			id: "a2" as Message["id"],
			updates: [{ type: MessageUpdateType.FinalAnswer, text: "done", interrupted: false }],
		});
		expect(isConversationGenerationActive([latestRunning, latestDone])).toBe(false);
	});

	test("interrupted wins even without any terminal update present", () => {
		const message = assistantMessage({ interrupted: true, updates: undefined });
		expect(isAssistantGenerationTerminal(message)).toBe(true);
	});
});
