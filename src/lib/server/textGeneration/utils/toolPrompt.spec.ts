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
});
