import { describe, expect, test } from "vitest";

import type { Message } from "$lib/types/Message";
import {
	MessageToolUpdateType,
	MessageUpdateStatus,
	MessageUpdateType,
} from "$lib/types/MessageUpdate";
import { ToolResultStatus } from "$lib/types/Tool";
import {
	isAssistantGenerationTerminal,
	isAssistantParkedOnWait,
	isConversationGenerationActive,
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

	// A parked-and-resumed turn (the wait tool) has a lifecycle: every park
	// stamps `finished`, every resume stamps a new `started`. The LAST lifecycle
	// event decides — "ever finished" would freeze the message at its first park.

	test("a resume after a park makes the message active again", () => {
		const message = assistantMessage({
			updates: [
				{ type: MessageUpdateType.Status, status: MessageUpdateStatus.Started },
				{ type: MessageUpdateType.Status, status: MessageUpdateStatus.Finished },
				{ type: MessageUpdateType.Status, status: MessageUpdateStatus.Started },
				{ type: MessageUpdateType.Stream, token: "resumed output" },
			],
		});
		expect(isAssistantGenerationTerminal(message)).toBe(false);
		expect(isConversationGenerationActive([message])).toBe(true);
	});

	test("a turn parked again after a resume reads terminal until the next start", () => {
		const message = assistantMessage({
			updates: [
				{ type: MessageUpdateType.Status, status: MessageUpdateStatus.Started },
				{ type: MessageUpdateType.Status, status: MessageUpdateStatus.Finished },
				{ type: MessageUpdateType.Status, status: MessageUpdateStatus.Started },
				{ type: MessageUpdateType.Status, status: MessageUpdateStatus.Finished },
			],
		});
		expect(isAssistantGenerationTerminal(message)).toBe(true);
	});

	test("a final answer after the last start is terminal", () => {
		const message = assistantMessage({
			updates: [
				{ type: MessageUpdateType.Status, status: MessageUpdateStatus.Started },
				{ type: MessageUpdateType.Status, status: MessageUpdateStatus.Finished },
				{ type: MessageUpdateType.Status, status: MessageUpdateStatus.Started },
				{ type: MessageUpdateType.FinalAnswer, text: "done", interrupted: false },
			],
		});
		expect(isAssistantGenerationTerminal(message)).toBe(true);
	});
});

describe("isAssistantParkedOnWait", () => {
	const waitCall = (uuid: string) => ({
		type: MessageUpdateType.Tool as const,
		subtype: MessageToolUpdateType.Call as const,
		uuid,
		call: { name: "wait", parameters: { seconds: 60, reason: "job running" } },
	});
	const resultFor = (uuid: string) => ({
		type: MessageUpdateType.Tool as const,
		subtype: MessageToolUpdateType.Result as const,
		uuid,
		result: {
			status: ToolResultStatus.Success as const,
			call: { name: "wait", parameters: {} },
			outputs: [],
			display: true,
		},
	});

	test("a wait call without a result is parked, even though the run finished", () => {
		const message = assistantMessage({
			updates: [
				waitCall("w1"),
				{ type: MessageUpdateType.Status, status: MessageUpdateStatus.Finished },
			],
		});
		expect(isAssistantParkedOnWait(message)).toBe(true);
		expect(isAssistantGenerationTerminal(message)).toBe(true);
	});

	test("a resumed wait (call with result) is no longer parked", () => {
		const message = assistantMessage({
			updates: [waitCall("w1"), resultFor("w1")],
		});
		expect(isAssistantParkedOnWait(message)).toBe(false);
	});

	test("only wait calls count, and interrupted turns are never parked", () => {
		const otherCall = {
			type: MessageUpdateType.Tool as const,
			subtype: MessageToolUpdateType.Call as const,
			uuid: "t1",
			call: { name: "hf_fs", parameters: {} },
		};
		expect(isAssistantParkedOnWait(assistantMessage({ updates: [otherCall] }))).toBe(false);
		expect(
			isAssistantParkedOnWait(assistantMessage({ interrupted: true, updates: [waitCall("w1")] }))
		).toBe(false);
	});
});
