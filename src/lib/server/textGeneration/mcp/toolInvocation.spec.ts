import { describe, expect, it } from "vitest";
import { isValidJsonObject } from "./toolInvocation";

describe("isValidJsonObject", () => {
	it("accepts a well-formed JSON object", () => {
		expect(isValidJsonObject('{"city":"Paris"}')).toBe(true);
		expect(isValidJsonObject("{}")).toBe(true);
	});

	it("rejects malformed or truncated JSON", () => {
		// The exact failure mode this guards: a model streams a truncated
		// arguments string, which must never be persisted as argumentsRaw and
		// later replayed as an invalid historical tool_calls.function.arguments.
		expect(isValidJsonObject('{"city":"Pari')).toBe(false);
		expect(isValidJsonObject("")).toBe(false);
		expect(isValidJsonObject("not json at all")).toBe(false);
	});

	it("rejects valid JSON that isn't an object", () => {
		// Tool-call arguments must be an object; arrays/primitives/null are
		// syntactically valid JSON but never a valid arguments shape.
		expect(isValidJsonObject("[1,2,3]")).toBe(false);
		expect(isValidJsonObject("null")).toBe(false);
		expect(isValidJsonObject('"a string"')).toBe(false);
		expect(isValidJsonObject("42")).toBe(false);
	});
});
