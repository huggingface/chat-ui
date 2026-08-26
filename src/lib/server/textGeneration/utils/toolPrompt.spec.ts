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

	it("survives a timezone the client made up", () => {
		// Client-supplied, validated only as a string. Intl throws on an unknown
		// zone, and the throw is caught upstream — which silently answers without
		// tools instead of failing, so it is easy to miss.
		const prompt = buildToolPreprompt([tool("web_search_exa")], "Not/AZone");

		expect(prompt).toContain("web_search_exa");
		expect(prompt).not.toContain("Not/AZone");
	});

	it("only includes a builtin's guidance when that tool is on offer", () => {
		const askBuiltin = {
			name: "ask_user_question",
			preprompt: "ASKING THE USER: put decisions to the user as options.",
			exemptFromToolRestraint: true,
		};

		// Declared builtins whose definition is not among the offered tools stay silent.
		const without = buildToolPreprompt([tool("web_search_exa")], undefined, [askBuiltin]);
		expect(without).not.toContain("ASKING THE USER:");
		expect(without).not.toContain("This does not apply to");

		const withAsk = buildToolPreprompt(
			[tool("web_search_exa"), tool("ask_user_question")],
			undefined,
			[askBuiltin]
		);
		expect(withAsk).toContain("ASKING THE USER:");
		// Without the carve-out the blanket "do not use a tool" above rules the question out.
		expect(withAsk).toContain("This does not apply to ask_user_question");
	});

	it("names every restraint-exempt builtin in the carve-out", () => {
		const builtins = [
			{
				name: "ask_user_question",
				preprompt: "ASKING THE USER: ask.",
				exemptFromToolRestraint: true,
			},
			{ name: "update_plan", preprompt: "PLANNING: plan.", exemptFromToolRestraint: true },
		];
		const prompt = buildToolPreprompt(
			[tool("ask_user_question"), tool("update_plan")],
			undefined,
			builtins
		);
		expect(prompt).toContain("This does not apply to ask_user_question or update_plan");
		expect(prompt).toContain("ASKING THE USER:");
		expect(prompt).toContain("PLANNING:");
	});
});
