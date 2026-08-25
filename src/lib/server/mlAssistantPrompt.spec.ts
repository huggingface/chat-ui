import { describe, expect, it } from "vitest";
import { ML_ASSISTANT_PREPROMPT, mlAssistantSessionContext } from "./mlAssistantPrompt";
import { buildToolPreprompt } from "./textGeneration/utils/toolPrompt";
import { ARTIFACTS_SYSTEM_PROMPT } from "./textGeneration/artifacts";
import { askUserQuestionBuiltin } from "./textGeneration/builtinTools/askUserQuestion";
import type { OpenAiTool } from "$lib/server/mcp/tools";

const tool = (name: string): OpenAiTool =>
	({
		type: "function",
		function: { name, description: "", parameters: { type: "object", properties: {} } },
	}) as OpenAiTool;

const HF_TOOLS = [tool("hf_jobs"), tool("hf_fs"), tool("hub_repo_details")];

/** The preset's system message, as `runMcpFlow` asks for it. */
const inMode = (tools: OpenAiTool[]) =>
	buildToolPreprompt(tools, undefined, undefined, { mlAssistant: true });

describe("ML Assistant preprompt", () => {
	it("ships text that does not depend on the model or a template engine", () => {
		expect(ML_ASSISTANT_PREPROMPT.trim().length).toBeGreaterThan(0);
		expect(ML_ASSISTANT_PREPROMPT).not.toMatch(/\{\{|\$\{/);
	});

	it("keeps every section that carries a rule", () => {
		for (const heading of [
			"# Your knowledge of the HF libraries is outdated",
			"# Mistakes you WILL make without checking",
			"# Before you propose a training or evaluation run",
			"# Audit the data before you use it",
			"# When you write ML code",
			"# Submitting jobs",
			"# Scripts: artifact or payload",
			"# When a run fails",
			"# Finishing",
		]) {
			expect(ML_ASSISTANT_PREPROMPT).toContain(heading);
		}
	});

	it("names each failure mode it wants the model to recognize", () => {
		for (const mode of [
			"HALLUCINATED IMPORTS",
			"WRONG TRAINER ARGUMENTS",
			"WRONG DATASET FORMAT",
			"SILENT DATASET SUBSTITUTION",
			"LOST MODELS",
			"DEFAULT TIMEOUTS KILL JOBS",
			"BATCH FAILURES",
			"NEVER COMPILE FLASH-ATTENTION",
			"SCOPE-CHANGING FIXES",
		]) {
			expect(ML_ASSISTANT_PREPROMPT).toContain(mode);
		}
	});

	it("states the push-to-hub rule more than once", () => {
		// Deliberate redundancy, not an oversight: a finished run that pushed
		// nothing is unrecoverable, so the rule is restated at every surface it can
		// be violated at. Collapsing these into one mention is a regression.
		const mentions = ML_ASSISTANT_PREPROMPT.match(/push_to_hub/g) ?? [];
		expect(mentions.length).toBeGreaterThanOrEqual(2);
	});

	it("refers only to tools this harness actually has", () => {
		// The doctrine was ported from a harness with a shell and a sandbox. A rule
		// naming a tool that isn't on offer is dead text the model can't act on.
		for (const absent of ["sandbox", "/app/", "bash", "read_file", "write_file"]) {
			expect(ML_ASSISTANT_PREPROMPT).not.toContain(absent);
		}
	});
});

describe("ML Assistant system message size", () => {
	it("stays under the ceiling it is re-sent at", () => {
		// The preset's tool preprompt, prompt and the artifacts prompt it
		// force-enables are one system message, re-sent on every round of every
		// turn — and the mode's round budget is a hundred. This is a deliberate
		// ceiling, not a measurement: growing past it should be a decision someone
		// makes here, not something that happens a paragraph at a time.
		//
		// Counted with one builtin's guidance in it. The GitHub grounding tools add
		// their own on top when a GITHUB_TOKEN is configured, which is the headroom
		// between this and the ceiling.
		const composed = [
			buildToolPreprompt(
				[...HF_TOOLS, tool("ask_user_question")],
				undefined,
				[askUserQuestionBuiltin],
				{ mlAssistant: true }
			),
			ML_ASSISTANT_PREPROMPT,
			ARTIFACTS_SYSTEM_PROMPT,
		].join("\n\n");

		expect(composed.length).toBeLessThan(18_000);
	});
});

describe("ML Assistant session context", () => {
	const now = new Date("2026-08-24T09:07:00Z");

	it("stamps the user so the namespace rule has something to read", () => {
		expect(mlAssistantSessionContext({ username: "pngwn", timezone: "UTC", now })).toBe(
			"[Session context: Date=2026-08-24, Time=09:07, Timezone=UTC, User=pngwn]"
		);
	});

	it("says unknown rather than omitting the user", () => {
		// The prompt keys "don't guess a namespace" off this exact value, so an
		// absent username has to be stated rather than left out.
		expect(mlAssistantSessionContext({ timezone: "UTC", now })).toContain("User=unknown");
		expect(mlAssistantSessionContext({ username: "   ", timezone: "UTC", now })).toContain(
			"User=unknown"
		);
	});

	it("stamps the time in the user's zone", () => {
		expect(mlAssistantSessionContext({ timezone: "Europe/Berlin", now })).toContain("Time=11:07");
		expect(mlAssistantSessionContext({ now })).not.toContain("Timezone=");
	});
});

describe("ML Assistant tool preprompt", () => {
	it("replaces the generic restraint rule instead of joining it", () => {
		// The generic text names writing code as a case to answer without tools,
		// which is the inverse of this mode's doctrine. Both in one system message
		// is a contradiction, so the mode swaps the paragraph rather than adding to
		// it.
		expect(buildToolPreprompt(HF_TOOLS)).toContain("Do NOT call a tool unless");
		expect(inMode(HF_TOOLS)).not.toContain("Do NOT call a tool unless");
		expect(inMode(HF_TOOLS)).toContain("USING TOOLS:");
	});

	it("swaps the web-search paragraphs for the Hub ones", () => {
		expect(inMode(HF_TOOLS)).not.toContain("SEARCH: Use 3-6 precise keywords");
		expect(inMode(HF_TOOLS)).toContain("only source of facts about the Hub");
		expect(inMode(HF_TOOLS)).toContain("WHEN RESULTS ARE LARGE:");
	});

	it("still sends everything a builtin tool contributes", () => {
		// The reason this is a swap inside one builder rather than a second
		// builder: per-builtin guidance is added over time, and a parallel copy
		// silently stops carrying whatever is added to the other one.
		const builtin = {
			name: "update_plan",
			preprompt: "PLANNING: keep exactly one step in progress.",
		};

		const prompt = buildToolPreprompt([...HF_TOOLS, tool("update_plan")], undefined, [builtin], {
			mlAssistant: true,
		});

		expect(prompt).toContain("PLANNING: keep exactly one step in progress.");
		expect(prompt).toContain("hf_jobs, hf_fs, hub_repo_details, update_plan");
	});

	it("says nothing when there are no tools", () => {
		expect(inMode([])).toBe("");
	});
});
