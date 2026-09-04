import { describe, it, expect } from "vitest";
import { hasTruncatedToolCall, parseToolArguments, withParseableArguments } from "./toolArgs";

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

describe("hasTruncatedToolCall", () => {
	const good = { name: "hf_fs", arguments: '{"path":"README.md"}' };
	const cutOff = { name: "hf_fs_write", arguments: '{"content":"line one' };

	it("ignores completions that did not hit the output limit", () => {
		expect(hasTruncatedToolCall("stop", [cutOff])).toBe(false);
		expect(hasTruncatedToolCall("tool_calls", [cutOff])).toBe(false);
		expect(hasTruncatedToolCall(undefined, [cutOff])).toBe(false);
	});

	it("reports a call whose arguments were cut off", () => {
		expect(hasTruncatedToolCall("length", [cutOff])).toBe(true);
		expect(hasTruncatedToolCall("length", [good, cutOff])).toBe(true);
	});

	// The limit can land after a complete arguments object; discarding those would
	// retry, and eventually give up on, a call that was fine.
	it("leaves complete calls alone even at the output limit", () => {
		expect(hasTruncatedToolCall("length", [good])).toBe(false);
		expect(hasTruncatedToolCall("length", [good, good])).toBe(false);
		expect(hasTruncatedToolCall("length", [])).toBe(false);
	});

	it("treats an empty argument string as a complete no-argument call", () => {
		expect(hasTruncatedToolCall("length", [{ name: "hf_whoami", arguments: "" }])).toBe(false);
		expect(hasTruncatedToolCall("length", [{ name: "hf_whoami" }])).toBe(false);
	});

	it("reports a call cut off before its name arrived", () => {
		expect(hasTruncatedToolCall("length", [{ arguments: "" }])).toBe(true);
	});
});

describe("withParseableArguments", () => {
	const call = (args: string) => ({
		id: "t1",
		type: "function" as const,
		function: { name: "ask_user_question", arguments: args },
	});

	it("replaces the payload that killed a turn in production", () => {
		// GLM emitted a bare "{" on a round that finished with tool_calls, so the
		// truncation guard had no reason to fire. Echoed back, it made the
		// provider reject every later request with
		// `400 Invalid JSON in tool call arguments: '{'`.
		const [out] = withParseableArguments([call("{")]);

		expect(out.function.arguments).toBe("{}");
	});

	it("keeps the call rather than dropping it, so its result is not orphaned", () => {
		const [out] = withParseableArguments([call("not json at all")]);

		expect(out.id).toBe("t1");
		expect(out.function.name).toBe("ask_user_question");
	});

	it("leaves valid arguments byte-exact", () => {
		const raw = '{"question":"Which split?","options":["train","test"]}';

		const [out] = withParseableArguments([call(raw)]);

		expect(out.function.arguments).toBe(raw);
	});

	it("does not touch calls it has no argument for", () => {
		const bare = { id: "t2", type: "function" as const, function: { name: "wait" } };

		expect(withParseableArguments([bare])[0]).toBe(bare);
	});
});
