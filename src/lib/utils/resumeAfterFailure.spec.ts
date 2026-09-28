import { describe, expect, test } from "vitest";

import type { Message } from "$lib/types/Message";
import {
	MessageToolUpdateType,
	MessageUpdateStatus,
	MessageUpdateType,
	type MessageUpdate,
} from "$lib/types/MessageUpdate";
import { buildResumeMessage, canResumeAfterFailure, failureDetailOf } from "./resumeAfterFailure";

function assistantMessage(updates: MessageUpdate[]): Message {
	return {
		from: "assistant",
		id: "assistant-1" as Message["id"],
		content: "",
		children: [],
		updates,
	};
}

const toolCall: MessageUpdate = {
	type: MessageUpdateType.Tool,
	subtype: MessageToolUpdateType.Call,
	uuid: "u1",
	call: { name: "hf_jobs", parameters: {} },
};

const errorStatus = (message?: string): MessageUpdate => ({
	type: MessageUpdateType.Status,
	status: MessageUpdateStatus.Error,
	...(message ? { message } : {}),
});

const failedTurnState = (error?: string): MessageUpdate => ({
	type: MessageUpdateType.TurnState,
	state: "failed",
	serverNow: 1_000,
	...(error ? { error } : {}),
});

describe("canResumeAfterFailure", () => {
	test("offers resume for a failed turn that ran tools", () => {
		expect(canResumeAfterFailure(assistantMessage([toolCall, errorStatus("boom")]))).toBe(true);
	});

	test("recognizes failure from the turn state alone (no legacy status)", () => {
		expect(canResumeAfterFailure(assistantMessage([toolCall, failedTurnState()]))).toBe(true);
	});

	test("withholds resume from a turn that failed before doing any work", () => {
		// No tool calls persisted: nothing to preserve, retry is strictly better.
		expect(canResumeAfterFailure(assistantMessage([errorStatus("boom")]))).toBe(false);
	});

	test("withholds resume from a turn that finished cleanly", () => {
		expect(
			canResumeAfterFailure(
				assistantMessage([
					toolCall,
					{ type: MessageUpdateType.FinalAnswer, text: "done", interrupted: false },
				])
			)
		).toBe(false);
	});

	test("ignores non-assistant and absent messages", () => {
		expect(canResumeAfterFailure(undefined)).toBe(false);
		expect(
			canResumeAfterFailure({
				from: "user",
				id: "user-1" as Message["id"],
				content: "hi",
				children: [],
			})
		).toBe(false);
	});
});

describe("failureDetailOf", () => {
	test("prefers the status error's real message over the generic turn-state error", () => {
		const message = assistantMessage([
			errorStatus("429 rate limited by router"),
			failedTurnState("The turn ended on an error."),
		]);
		expect(failureDetailOf(message)).toBe("429 rate limited by router");
	});

	test("falls back to the turn-state error when the status carries no message", () => {
		const message = assistantMessage([
			errorStatus(),
			failedTurnState("The turn ended on an error."),
		]);
		expect(failureDetailOf(message)).toBe("The turn ended on an error.");
	});

	test("truncates a huge upstream error instead of pasting it whole", () => {
		const detail = failureDetailOf(assistantMessage([errorStatus("x".repeat(2_000))]));
		expect(detail?.length).toBeLessThan(600);
		expect(detail?.endsWith("…")).toBe(true);
	});

	test("returns undefined when nothing failed", () => {
		expect(failureDetailOf(assistantMessage([]))).toBeUndefined();
	});
});

describe("buildResumeMessage", () => {
	test("carries the failure detail so the model can tell transient from structural", () => {
		const text = buildResumeMessage("429 rate limited");
		expect(text).toContain("429 rate limited");
		expect(text).toContain("continue the task");
	});

	test("still reads sensibly with no detail available", () => {
		const text = buildResumeMessage(undefined);
		expect(text).not.toContain("error:");
		expect(text).toContain("Don't restart from scratch");
	});
});
