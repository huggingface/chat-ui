import { describe, expect, it } from "vitest";
import {
	capturePreviewError,
	composeFixRequest,
	MAX_COUNTED_REPEATS,
	MAX_DISTINCT_CAPTURED_ERRORS,
	normalizePreviewError,
	type CapturedPreviewError,
} from "$lib/utils/previewSrcdoc";

function capture(errors: { message: string; stack?: string }[]): CapturedPreviewError[] {
	return errors.reduce<CapturedPreviewError[]>((acc, e) => capturePreviewError(acc, e), []);
}

describe("normalizePreviewError", () => {
	it("keeps string stacks and coerces messages", () => {
		expect(normalizePreviewError({ message: "boom", stack: "  at a:1" })).toEqual({
			message: "boom",
			stack: "  at a:1",
		});
	});

	it("drops non-string stacks instead of crashing later rendering", () => {
		expect(normalizePreviewError({ message: "boom", stack: {} })).toEqual({
			message: "boom",
			stack: undefined,
		});
		expect(normalizePreviewError({ message: "boom", stack: 42 }).stack).toBeUndefined();
	});

	it("survives arbitrary payload shapes", () => {
		expect(normalizePreviewError(null)).toEqual({ message: "Error", stack: undefined });
		expect(normalizePreviewError("boom")).toEqual({ message: "Error", stack: undefined });
		expect(normalizePreviewError({ message: { evil: true } }).message).toBe("[object Object]");
	});

	it("trims oversized fields", () => {
		const huge = "x".repeat(100_000);
		const out = normalizePreviewError({ message: huge, stack: huge });
		expect(out.message.length).toBeLessThanOrEqual(4000);
		expect(out.stack?.length).toBeLessThanOrEqual(4000);
	});
});

describe("capturePreviewError", () => {
	it("counts repeats of the same signature instead of storing them again", () => {
		const error = { message: "boom", stack: "  at loop:1" };
		const out = capture([error, error, error]);
		expect(out).toHaveLength(1);
		expect(out[0].count).toBe(3);
	});

	it("treats same message with different stacks as distinct", () => {
		const out = capture([
			{ message: "boom", stack: "  at a:1" },
			{ message: "boom", stack: "  at b:2" },
		]);
		expect(out).toHaveLength(2);
	});

	it("still admits and counts known signatures once the distinct cap is full", () => {
		const noisy = { message: "noisy" };
		let out = capture([noisy]);
		for (let i = 0; i < MAX_DISTINCT_CAPTURED_ERRORS + 10; i++) {
			out = capturePreviewError(out, { message: `unique ${i}` });
		}
		expect(out).toHaveLength(MAX_DISTINCT_CAPTURED_ERRORS);
		// A late repeat of the first (noisy) signature still bumps its count
		out = capturePreviewError(out, noisy);
		expect(out[0].count).toBe(2);
		// A never-seen signature past the cap is dropped
		out = capturePreviewError(out, { message: "too late" });
		expect(out).toHaveLength(MAX_DISTINCT_CAPTURED_ERRORS);
	});

	it("returns a new array so state assignment triggers reactivity", () => {
		const first = capture([{ message: "boom" }]);
		const second = capturePreviewError(first, { message: "boom" });
		expect(second).not.toBe(first);
		expect(first[0].count).toBe(1);
	});

	it("saturates repeat counting so endless repeats stop producing new state", () => {
		const noisy = { message: "noisy" };
		let out = capture([noisy]);
		for (let i = 0; i < MAX_COUNTED_REPEATS + 50; i++) {
			out = capturePreviewError(out, noisy);
		}
		expect(out[0].count).toBe(MAX_COUNTED_REPEATS);
		// Once saturated, the same reference comes back: a reactive no-op
		expect(capturePreviewError(out, noisy)).toBe(out);
		// New signatures are still admitted after saturation
		expect(capturePreviewError(out, { message: "other" })).toHaveLength(2);
	});
});

describe("composeFixRequest", () => {
	it("composes a single error with its stack", () => {
		expect(
			composeFixRequest(
				capture([{ message: "x is not defined", stack: "ReferenceError: x\n  at app:1" }])
			)
		).toBe("it's not working: x is not defined\nReferenceError: x\n  at app:1 - can you fix it?");
	});

	it("composes a single error without a stack", () => {
		expect(composeFixRequest(capture([{ message: "boom" }]))).toBe(
			"it's not working: boom - can you fix it?"
		);
	});

	it("renders repeats of a single error as a count", () => {
		const error = { message: "boom", stack: "Error: boom\n  at loop:1" };
		expect(composeFixRequest(capture([error, error, error]))).toBe(
			"it's not working: boom (repeated 3 times)\nError: boom\n  at loop:1 - can you fix it?"
		);
	});

	it("lists every distinct error with its stack", () => {
		const out = composeFixRequest(
			capture([
				{ message: "a", stack: "Error: a\n  at a:1" },
				{ message: "b", stack: "Error: b\n  at b:1" },
				{ message: "b", stack: "Error: b\n  at b:1" },
				{ message: "c" },
			])
		);
		expect(out).toBe(
			"it's not working, I see 3 errors:\n" +
				"1. a\nError: a\n  at a:1\n" +
				"2. b (repeated 2 times)\nError: b\n  at b:1\n" +
				"3. c\n" +
				"can you fix them?"
		);
	});

	it("caps the list at 5 distinct errors and counts the rest", () => {
		const out = composeFixRequest(
			capture(Array.from({ length: 8 }, (_, i) => ({ message: `error ${i}` })))
		);
		expect(out).toContain("I see 8 errors:");
		expect(out).toContain("5. error 4");
		expect(out).not.toContain("error 5");
		expect(out).toContain("(+3 more distinct errors)");
	});

	it("trims stacks to their top frames", () => {
		const stack = Array.from({ length: 12 }, (_, i) => `  at frame:${i}`).join("\n");
		const out = composeFixRequest(capture([{ message: "deep", stack }]));
		expect(out).toContain("  at frame:4");
		expect(out).not.toContain("  at frame:5");
	});

	it("truncates a pathologically long error", () => {
		const out = composeFixRequest(capture([{ message: "x".repeat(5000) }]));
		expect(out.length).toBeLessThan(800);
		expect(out).toContain("…");
	});

	it("marks saturated repeat counts as a lower bound", () => {
		const saturated: CapturedPreviewError[] = [{ message: "noisy", count: MAX_COUNTED_REPEATS }];
		expect(composeFixRequest(saturated)).toContain(`(repeated ${MAX_COUNTED_REPEATS}+ times)`);
	});
});
