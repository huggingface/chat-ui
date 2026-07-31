import { describe, it, expect } from "vitest";
import { parseToolArguments } from "./toolArgs";

describe("parseToolArguments", () => {
	it("decodes a well-formed object", () => {
		expect(parseToolArguments('{"repo_id":"acme/model","limit":5}')).toEqual({
			repo_id: "acme/model",
			limit: 5,
		});
	});

	it("treats an absent or empty argument string as no arguments", () => {
		expect(parseToolArguments(undefined)).toEqual({});
		expect(parseToolArguments("")).toEqual({});
		expect(parseToolArguments("   ")).toEqual({});
		expect(parseToolArguments("{}")).toEqual({});
	});

	// The shape a stream cut off by the output limit leaves behind.
	it("rejects JSON truncated mid-object", () => {
		expect(parseToolArguments('{"repo_id":"acme/model","content":"line one')).toBeNull();
		expect(parseToolArguments('{"repo_id":')).toBeNull();
		expect(parseToolArguments("{")).toBeNull();
	});

	it("rejects values that are not JSON objects", () => {
		expect(parseToolArguments('["acme/model"]')).toBeNull();
		expect(parseToolArguments('"acme/model"')).toBeNull();
		expect(parseToolArguments("42")).toBeNull();
		expect(parseToolArguments("null")).toBeNull();
	});

	it("rejects non-string input", () => {
		expect(parseToolArguments(42)).toBeNull();
		expect(parseToolArguments({ repo_id: "acme/model" })).toBeNull();
	});
});
