import { describe, it, expect } from "vitest";
import { stripThink } from "./stripThink";

describe("stripThink", () => {
	it("leaves text without reasoning untouched", () => {
		expect(stripThink("Python string reversal")).toBe("Python string reversal");
	});

	it("removes a complete block and its contents", () => {
		expect(stripThink("<think>deliberating</think>Python string reversal")).toBe(
			"Python string reversal"
		);
	});

	it("removes an unterminated block left by a budget cutoff", () => {
		expect(stripThink("<think>We need to produce a title. The user is")).toBe("");
	});

	it("removes every block when several are present", () => {
		expect(stripThink("<think>a</think>one<think>b</think>two")).toBe("onetwo");
	});

	it("keeps text that precedes a block", () => {
		expect(stripThink("visible<think>hidden</think>")).toBe("visible");
	});
});
