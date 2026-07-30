import { describe, expect, it } from "vitest";
import { composeFixRequest } from "$lib/utils/previewSrcdoc";

describe("composeFixRequest", () => {
	it("composes a single error with its stack", () => {
		expect(
			composeFixRequest([{ message: "x is not defined", stack: "ReferenceError: x\n  at app:1" }])
		).toBe("it's not working: x is not defined\nReferenceError: x\n  at app:1 - can you fix it?");
	});

	it("composes a single error without a stack", () => {
		expect(composeFixRequest([{ message: "boom" }])).toBe(
			"it's not working: boom - can you fix it?"
		);
	});

	it("collapses repeats of the same error into a count", () => {
		const error = { message: "boom", stack: "Error: boom\n  at loop:1" };
		expect(composeFixRequest([error, error, error])).toBe(
			"it's not working: boom (repeated 3 times)\nError: boom\n  at loop:1 - can you fix it?"
		);
	});

	it("lists every distinct error with its stack", () => {
		const out = composeFixRequest([
			{ message: "a", stack: "Error: a\n  at a:1" },
			{ message: "b", stack: "Error: b\n  at b:1" },
			{ message: "b", stack: "Error: b\n  at b:1" },
			{ message: "c" },
		]);
		expect(out).toBe(
			"it's not working, I see 3 errors:\n" +
				"1. a\nError: a\n  at a:1\n" +
				"2. b (repeated 2 times)\nError: b\n  at b:1\n" +
				"3. c\n" +
				"can you fix them?"
		);
	});

	it("treats same message with different stacks as distinct errors", () => {
		const out = composeFixRequest([
			{ message: "undefined is not a function", stack: "  at siteA:1" },
			{ message: "undefined is not a function", stack: "  at siteB:2" },
		]);
		expect(out).toContain("I see 2 errors:");
	});

	it("caps the list at 5 distinct errors and counts the rest", () => {
		const errors = Array.from({ length: 8 }, (_, i) => ({ message: `error ${i}` }));
		const out = composeFixRequest(errors);
		expect(out).toContain("I see 8 errors:");
		expect(out).toContain("5. error 4");
		expect(out).not.toContain("error 5");
		expect(out).toContain("(+3 more distinct errors)");
	});

	it("trims stacks to their top frames", () => {
		const stack = Array.from({ length: 12 }, (_, i) => `  at frame:${i}`).join("\n");
		const out = composeFixRequest([{ message: "deep", stack }]);
		expect(out).toContain("  at frame:4");
		expect(out).not.toContain("  at frame:5");
	});

	it("truncates a pathologically long error", () => {
		const out = composeFixRequest([{ message: "x".repeat(5000) }]);
		expect(out.length).toBeLessThan(800);
		expect(out).toContain("…");
	});
});
