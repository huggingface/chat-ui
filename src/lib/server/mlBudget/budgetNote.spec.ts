import { describe, expect, it } from "vitest";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { appendToLastToolMessage, budgetChangeNote } from "./budgetNote";

const budget = (totalMicroUsd: number, spentMicroUsd = 0) => ({
	totalMicroUsd,
	spentMicroUsd,
	reservations: [],
});

describe("budgetChangeNote", () => {
	it("says nothing while the total is what the model was told", () => {
		expect(budgetChangeNote(1_000_000, budget(1_000_000, 400_000))).toBeUndefined();
		expect(budgetChangeNote(0, undefined)).toBeUndefined();
	});

	it("tells the model about a total raised mid-turn", () => {
		expect(budgetChangeNote(0, budget(1_220_000))).toContain("now $1.22 remaining of $1.22");
	});

	it("counts spend already made against the new total", () => {
		expect(budgetChangeNote(1_000_000, budget(2_000_000, 500_000))).toContain(
			"now $1.50 remaining of $2.00"
		);
	});
});

describe("appendToLastToolMessage", () => {
	it("adds the note to the last tool result only", () => {
		const messages: ChatCompletionMessageParam[] = [
			{ role: "user", content: "go" },
			{ role: "tool", tool_call_id: "a", content: "first" },
			{ role: "tool", tool_call_id: "b", content: "second" },
		];
		const out = appendToLastToolMessage(messages, "NOTE");
		expect(out[1]).toEqual(messages[1]);
		expect(out[2]).toEqual({ role: "tool", tool_call_id: "b", content: "second\n\nNOTE" });
		// The input is left alone.
		expect(messages[2].content).toBe("second");
	});

	it("appends a text part to array content", () => {
		const out = appendToLastToolMessage(
			[{ role: "tool", tool_call_id: "a", content: [{ type: "text", text: "x" }] }],
			"NOTE"
		);
		expect(out[0].content).toEqual([
			{ type: "text", text: "x" },
			{ type: "text", text: "\n\nNOTE" },
		]);
	});
});
