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
			"# Reading a paper you are about to implement",
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
			"PERMISSION ERRORS ARE NOT RETRIES",
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

describe("ML Assistant tool-keyed doctrine", () => {
	it("sends the job contract only to a run that can submit jobs", () => {
		// It restates rules the preset prompt already carries, deliberately, at the
		// surface they get violated at — but a run without the tool would be
		// reading a contract for something it cannot do.
		expect(inMode([tool("hf_jobs")])).toContain("RUNNING JOBS (hf_jobs):");
		expect(inMode([tool("hf_fs")])).not.toContain("RUNNING JOBS");
	});

	it("states the three that cost a whole run", () => {
		const jobs = inMode([tool("hf_jobs")]);

		// Each of these fails late or silently: no token means the push fails after
		// the training, no flavor means it trains on two CPU cores, and a short
		// timeout kills the run at the end.
		expect(jobs).toContain("HF_TOKEN");
		expect(jobs).toContain("cpu-basic");
		expect(jobs).toContain("Timeout.");
		expect(jobs).toContain("push_to_hub");
	});

	it("points at the pricing doc instead of quoting rates", () => {
		// A price table in a prompt goes stale silently; a pointer does not.
		expect(inMode([tool("hf_jobs")])).toContain("hf://docs/hub/jobs-pricing.md");
	});

	it("reasons about hardware in cost to finish, not cost per hour", () => {
		// Every job in the first real run went to the cheapest flavor, because the
		// doctrine said "smallest" and never said "how long". Cheapest per hour is
		// not cheapest per job when a faster GPU finishes in a third of the time.
		const jobs = inMode([tool("hf_jobs")]);

		expect(jobs).toContain("cost to FINISH");
		expect(jobs).toContain("ask_user_question");
		expect(jobs).toContain("hf://docs/hub/jobs-pricing.md");
	});

	it("sends paper-finding rules with the filesystem tool", () => {
		// It searched for a paper by title with hub_repo_search — a repo search —
		// twice, and concluded nothing was there.
		const fs = inMode([tool("hf_fs")]);

		expect(fs).toContain("papers live at hf://papers");
		expect(fs).toContain("hub_repo_search searches REPOSITORIES");
		expect(inMode([tool("hf_jobs")])).not.toContain("papers live at hf://papers");
	});

	it("tells the model to create a repo before writing to it", () => {
		// "Repository not found" from a put reads like a permissions problem and is
		// not: it means nothing was created. That cost a real run several calls.
		const write = inMode([tool("hf_fs_write")]);

		expect(write).toContain("create_repo first");
		expect(write).toContain("Work in repos you created");
	});

	it("offers the sandbox as an optimisation with a fallback, not a dependency", () => {
		// Availability depends on the account and the deployment, so the doctrine
		// has to survive the tool being there and refusing to work.
		const sandbox = inMode([tool("hf_sandbox")]);

		expect(sandbox).toContain("SANDBOXES (hf_sandbox)");
		expect(sandbox).toContain("hf_jobs");
		expect(sandbox).toContain("do not retry");
		expect(inMode([tool("hf_jobs")])).not.toContain("SANDBOXES (hf_sandbox)");
	});

	it("guides web search only where web search exists", () => {
		// The mode replaces the generic tool preprompt, SEARCH paragraph included,
		// so a deployment with Exa configured would otherwise get none.
		expect(inMode([tool("web_search_exa")])).toContain("SEARCHING THE WEB");
		expect(inMode([tool("hf_fs")])).not.toContain("SEARCHING THE WEB");
	});

	it("sends the write rules only to a run that can write", () => {
		expect(inMode([tool("hf_fs_write")])).toContain("WRITING TO THE HUB (hf_fs_write):");
		expect(inMode([tool("hf_fs")])).not.toContain("WRITING TO THE HUB");
	});

	it("keeps each block on its own paragraph", () => {
		// They are lists the model reads down before acting, not sentences in the
		// run of general guidance.
		const both = inMode([tool("hf_jobs"), tool("hf_fs_write")]);
		expect(both.split("\n\n").length).toBeGreaterThan(2);
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
		// Counted with one builtin's guidance in it; the GitHub grounding tools add
		// their own when a GITHUB_TOKEN is configured.
		//
		// Raised deliberately each time, and the reasons are the point of keeping it:
		// 18k -> 19k for the hf_jobs submission contract; 19k -> 22k for the citation
		// hop, paper-finding, web search and cost-to-finish hardware; 22k -> 24k for
		// headroom alone, not content — at 21,889 the guard fired on every edit,
		// which makes it noise. That number is ~5,500 tokens, re-sent on every round
		// of a hundred-round budget: it is the figure to watch, and the next raise
		// should have to argue for itself against it.
		const composed = [
			buildToolPreprompt(
				// The worst case, not a typical one: every preset tool plus the web
				// search a configured deployment adds. A ceiling measured against a
				// smaller set is a ceiling that does not bind.
				[
					...HF_TOOLS,
					tool("hf_fs_write"),
					tool("ask_user_question"),
					tool("update_plan"),
					tool("github_find_examples"),
					tool("web_search_exa"),
					tool("hf_sandbox"),
				],
				undefined,
				[askUserQuestionBuiltin],
				{ mlAssistant: true }
			),
			ML_ASSISTANT_PREPROMPT,
			ARTIFACTS_SYSTEM_PROMPT,
		].join("\n\n");

		expect(composed.length).toBeLessThan(24_000);
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

	it("survives a timezone the client made up", () => {
		// `timezone` reaches this from the request body validated only as a string,
		// and Intl throws RangeError on an unknown zone. This runs before the
		// generation's try, so throwing here fails the whole turn.
		const stamped = mlAssistantSessionContext({ username: "pngwn", timezone: "Not/AZone", now });

		expect(stamped).toContain("User=pngwn");
		expect(stamped).toContain("Date=2026-08-24");
		// No zone is claimed, because none was honoured.
		expect(stamped).not.toContain("Timezone=");
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
