import { describe, expect, test } from "vitest";

import type { Message } from "$lib/types/Message";
import { MessageUpdateStatus, MessageUpdateType } from "$lib/types/MessageUpdate";
import {
	isAssistantGenerationTerminal,
	isConversationGenerationActive,
	isTurnSubscribable,
	turnStateOf,
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

describe("turn state as the authoritative liveness", () => {
	const state = (
		st: "running" | "waiting" | "awaiting_input" | "done" | "failed",
		extras: { until?: number; reason?: string } = {}
	) => ({
		type: MessageUpdateType.TurnState as const,
		state: st,
		serverNow: Date.now(),
		...extras,
	});

	test("turnStateOf returns the LAST turn state the message carries", () => {
		const message = assistantMessage({
			updates: [
				state("running"),
				state("waiting", { until: Date.now() + 60_000 }),
				state("running"),
			],
		});
		expect(turnStateOf(message)?.state).toBe("running");
		expect(turnStateOf(assistantMessage({ updates: [] }))).toBeUndefined();
	});

	test("only a running turn is non-terminal for UI purposes", () => {
		expect(isAssistantGenerationTerminal(assistantMessage({ updates: [state("running")] }))).toBe(
			false
		);
		for (const st of ["waiting", "awaiting_input", "done", "failed"] as const) {
			expect(isAssistantGenerationTerminal(assistantMessage({ updates: [state(st)] }))).toBe(true);
		}
	});

	test("the state wins over legacy lifecycle statuses when both are present", () => {
		// A parked run stamps `finished` after the waiting transition; the state,
		// not the status, is the truth.
		const message = assistantMessage({
			updates: [
				state("waiting", { until: Date.now() + 60_000, reason: "job" }),
				{ type: MessageUpdateType.Status, status: MessageUpdateStatus.Finished },
			],
		});
		expect(turnStateOf(message)?.state).toBe("waiting");
		expect(isAssistantGenerationTerminal(message)).toBe(true);
		expect(isTurnSubscribable(message)).toBe(true);
	});

	test("running, waiting and awaiting_input turns are subscribable; ended ones are not", () => {
		for (const st of ["running", "waiting", "awaiting_input"] as const) {
			expect(isTurnSubscribable(assistantMessage({ updates: [state(st)] }))).toBe(true);
		}
		for (const st of ["done", "failed"] as const) {
			expect(isTurnSubscribable(assistantMessage({ updates: [state(st)] }))).toBe(false);
		}
	});

	test("an interrupted message is neither active nor subscribable, whatever its state", () => {
		const message = assistantMessage({ interrupted: true, updates: [state("running")] });
		expect(isAssistantGenerationTerminal(message)).toBe(true);
		expect(isTurnSubscribable(message)).toBe(false);
	});

	test("messages without a turn state fall back to the legacy lifecycle", () => {
		const legacyLive = assistantMessage({
			updates: [{ type: MessageUpdateType.Status, status: MessageUpdateStatus.Started }],
		});
		expect(isTurnSubscribable(legacyLive)).toBe(true);
		const legacyDone = assistantMessage({
			updates: [{ type: MessageUpdateType.Status, status: MessageUpdateStatus.Finished }],
		});
		expect(isTurnSubscribable(legacyDone)).toBe(false);
	});
});
