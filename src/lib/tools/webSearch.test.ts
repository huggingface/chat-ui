import { describe, it, expect } from "vitest";
import buildWebSearchQuery from "./webSearch";

describe("buildWebSearchQuery", () => {
	it("returns empty string for empty conversation", () => {
		expect(buildWebSearchQuery([])).toBe("");
	});

	it("prefers the most recent user message", () => {
		const messages = [
			{ from: "user", content: "first user message" },
			{ from: "assistant", content: "assistant reply" },
			{ from: "user", content: "second user message" },
		];
		expect(buildWebSearchQuery(messages)).toBe("second user message");
	});

	it("falls back to assistant message if no user messages", () => {
		const messages = [{ from: "assistant", content: "assistant final thought" }];
		expect(buildWebSearchQuery(messages)).toBe("assistant final thought");
	});

	it("strips code fences, inline code and citations", () => {
		const messages = [
			{
				from: "user",
				content: "Here is some code:\n```js\nconsole.log(1)\n```\nAlso see [1]. Inline `x = 1`.",
			},
		];
		const q = buildWebSearchQuery(messages);
		expect(q).toBe("Here is some code: Also see . Inline .");
	});
});
