import { describe, expect, it } from "vitest";
import { buildToolPreprompt } from "./toolPrompt";
import type { OpenAiTool } from "$lib/server/mcp/tools";

const tool = (name: string): OpenAiTool =>
	({
		type: "function",
		function: { name, description: "", parameters: { type: "object", properties: {} } },
	}) as OpenAiTool;

describe("buildToolPreprompt", () => {
	it("returns empty string when no tools", () => {
		expect(buildToolPreprompt([])).toBe("");
	});

	it("lists tool names and includes grounding rules", () => {
		const prompt = buildToolPreprompt([tool("web_search_exa"), tool("crawling_exa")]);
		expect(prompt).toContain("web_search_exa, crawling_exa");
		expect(prompt).toContain("GROUNDING:");
		expect(prompt).toContain("only source of facts");
		expect(prompt).toContain("Never fabricate URLs, citations, or facts");
	});

	it("tells the model to follow up instead of answering from memory", () => {
		const prompt = buildToolPreprompt([tool("web_search_exa")]);
		expect(prompt).toContain("instead of answering from memory");
	});

	it("only guides asking the user when that tool is on offer", () => {
		const without = buildToolPreprompt([tool("web_search_exa")]);
		expect(without).not.toContain("ASKING THE USER:");
		expect(without).not.toContain("This does not apply to");

		const withAsk = buildToolPreprompt([tool("web_search_exa"), tool("ask_user_question")]);
		expect(withAsk).toContain("ASKING THE USER:");
		// Without the carve-out the blanket "do not use a tool" above rules the question out.
		expect(withAsk).toContain("This does not apply to ask_user_question");
	});
});
