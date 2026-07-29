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

	it("summarizes extra errors as a count", () => {
		expect(composeFixRequest([{ message: "a" }, { message: "b" }, { message: "c" }])).toBe(
			"it's not working: a (+2 more) - can you fix it?"
		);
	});
});
