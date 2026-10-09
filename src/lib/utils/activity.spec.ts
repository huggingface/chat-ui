import { describe, expect, it } from "vitest";
import {
	MessageToolUpdateType,
	MessageUpdateType,
	type MessageToolUpdate,
	type MessageUpdate,
} from "$lib/types/MessageUpdate";
import { ToolResultStatus } from "$lib/types/Tool";
import {
	activityLabels,
	classifyTool,
	collapseSteps,
	describeToolActivity,
	formatThought,
	humanizeToolName,
	isTrivialThinking,
	reasoningPreview,
	summarizeActivity,
	thoughtLabel,
	type ToolActivity,
} from "./activity";

const call = (
	name: string,
	args: Record<string, unknown> = {},
	uuid = name
): MessageToolUpdate => ({
	type: MessageUpdateType.Tool,
	subtype: MessageToolUpdateType.Call,
	uuid,
	call: { name, parameters: {} },
	argumentsRaw: JSON.stringify(args),
});
const ok = (name: string, uuid = name, text = "ok"): MessageToolUpdate => ({
	type: MessageUpdateType.Tool,
	subtype: MessageToolUpdateType.Result,
	uuid,
	result: {
		status: ToolResultStatus.Success,
		call: { name, parameters: {} },
		outputs: [{ text }],
		display: true,
	},
});
const failed = (uuid: string): MessageToolUpdate => ({
	type: MessageUpdateType.Tool,
	subtype: MessageToolUpdateType.Error,
	uuid,
	message: "403 Forbidden",
});

function activity(updates: MessageToolUpdate[], loading = false): ToolActivity {
	const described = describeToolActivity(updates, loading);
	if (!described) throw new Error("expected an activity");
	return described;
}
const done = (name: string, args: Record<string, unknown> = {}) =>
	activity([call(name, args), ok(name)]);
const failing = (name: string, args: Record<string, unknown> = {}) =>
	activity([call(name, args), failed(name)]);

describe("classifyTool", () => {
	it.each([
		["web_search_exa", "search"],
		["paper_search", "search"],
		["crawling_exa", "page"],
		["fetch_page", "page"],
		["run_python", "code"],
		["hf_sandbox_exec", "code"],
		["create_repo", "create"],
		["upload_file", "write"],
		["edit_file", "write"],
		["read_file", "file"],
		["hf_fs", "file"],
		["list_repo_files", "lookup"],
		["get_space_runtime", "lookup"],
		["hf_whoami", "lookup"],
		["gr1_flux1_schnell_infer", "image"],
		["do_thing", "other"],
	])("%s is %s", (name, kind) => {
		expect(classifyTool(name)).toBe(kind);
	});

	it("humanizes names nothing else describes", () => {
		expect(humanizeToolName("hf_doc_search")).toBe("doc search");
		expect(humanizeToolName("web_search_exa")).toBe("web search");
	});
});

describe("describeToolActivity", () => {
	it("says what a running search looks for, and that it searched once done", () => {
		expect(
			activity([call("web_search_exa", { query: "LMArena open models" })], true)
		).toMatchObject({
			status: "running",
			verb: "Searching the web",
			subject: "LMArena open models",
		});
		expect(done("web_search_exa", { query: "x" }).verb).toBe("Searched the web");
		expect(done("paper_search", { query: "flash attention" }).verb).toBe("Searched papers");
	});

	it("names the site a page fetch reads, and how many when it reads several", () => {
		const url = "https://www.arena.ai/leaderboard/text";
		expect(done("crawling_exa", { url })).toMatchObject({
			verb: "Read arena.ai",
			phrase: "read arena.ai",
		});
		expect(
			done("crawling_exa", { urls: ["https://a.org/x", "https://b.org/y", "https://a.org/z"] })
		).toMatchObject({ verb: "Read 3 pages", subject: "a.org, b.org", mono: false });
	});

	it("says what could not be done, for every kind of call", () => {
		expect(failing("crawling_exa", { url: "https://lmarena.ai" }).verb).toBe(
			"Couldn't read lmarena.ai"
		);
		expect(failing("web_search_exa", { query: "x" }).verb).toBe("Couldn't search the web");
		expect(failing("run_python", { code: "print(1)" }).verb).toBe("Couldn't run Python");
		expect(failing("upload_file", { path_in_repo: "app.py" }).verb).toBe("Couldn't upload app.py");
	});

	it("treats an error inside a successful result as a failure", () => {
		const updates = [
			call("hf_fs", { operations: [{ cmd: "cat", args: ["hf://datasets/x/y/README.md"] }] }),
			ok("hf_fs", "hf_fs", "[HF_FS_NOT_FOUND] no such file"),
		];
		expect(activity(updates).status).toBe("error");
		expect(
			activity([call("x_api"), ok("x_api", "x_api", '{"error": "rate limited"}')]).status
		).toBe("error");
	});

	it("marks a call the turn ended before as stopped, not done", () => {
		expect(activity([call("web_search_exa", { query: "x" })], false)).toMatchObject({
			status: "stopped",
			verb: "Stopped searching the web",
		});
	});

	it("uses the file or repo a call acts on as its subject", () => {
		expect(
			done("upload_file", { repo_id: "victor/pdf-chat", path_in_repo: "app.py" })
		).toMatchObject({
			verb: "Uploaded app.py",
			subject: "app.py",
			mono: true,
		});
		expect(done("create_repo", { repo_id: "victor/pdf-chat", repo_type: "space" })).toMatchObject({
			verb: "Created a Space",
			subject: "victor/pdf-chat",
		});
		expect(done("read_file", { name: "train.py" })).toMatchObject({ verb: "Read train.py" });
		expect(done("edit_file", { name: "train.py" })).toMatchObject({ verb: "Edited train.py" });
	});

	it("counts the lines of code a run executes instead of quoting it", () => {
		expect(done("run_python", { code: "import x\nprint(1)\nprint(2)" })).toMatchObject({
			verb: "Ran Python",
			subject: "3 lines",
		});
	});

	describe("Hub file system calls", () => {
		it("reads what a search, a listing and a file read act on", () => {
			expect(
				done("hf_fs", {
					operations: [
						{ cmd: "search", args: ["hf://spaces", "text to speech", "--sort", "likes"] },
					],
				})
			).toMatchObject({ verb: "Searched Hub Spaces", subject: "text to speech" });
			expect(
				done("hf_fs", {
					operations: [{ cmd: "ls", args: ["hf://datasets/HuggingFaceFW", "--limit", "10"] }],
				})
			).toMatchObject({ verb: "Listed HuggingFaceFW" });
			expect(
				done("hf_fs", {
					operations: [{ cmd: "cat", args: ["hf://datasets/HuggingFaceFW/finephrase/README.md"] }],
				})
			).toMatchObject({
				verb: "Read README.md",
				subject: "datasets/HuggingFaceFW/finephrase/README.md",
			});
		});

		it("says when one call runs several operations", () => {
			expect(
				done("hf_fs", {
					operations: [
						{ cmd: "cat", args: ["hf://a/b/c.md"] },
						{ cmd: "cat", args: ["hf://a/b/d.md"] },
					],
				}).detail
			).toBe("+1 more");
		});
	});

	describe("sandbox and jobs calls", () => {
		it("tells starting a sandbox from running a command in it", () => {
			expect(
				done("hf_sandbox", { cmd: "create", args: ["create", "--flavor", "cpu-basic"] })
			).toMatchObject({ verb: "Started a sandbox", subject: "cpu-basic" });
			expect(
				done("hf_sandbox_exec", {
					args: ["exec", "hfsb2:victor:abc", "pip install trl && python train.py"],
				})
			).toMatchObject({
				verb: "Ran a sandbox command",
				subject: "pip install trl && python train.py",
			});
		});

		it("tells starting a job from reading its logs", () => {
			expect(
				done("hf_jobs", { operation: "run", args: { command: ["python", "-c", "print(1)"] } })
			).toMatchObject({ verb: "Started a job", subject: "python -c print(1)" });
			expect(done("hf_jobs", { operation: "logs", args: { job_id: "6ac51b34" } })).toMatchObject({
				verb: "Read job logs",
				subject: "6ac51b34",
			});
		});
	});

	it("never shows a secret from the arguments on a row", () => {
		const row = activity(
			[
				call("hf_sandbox_exec", {
					args: ["exec", "hfsb2:victor:abc", "hf auth login --token hf_abcdefghijklmnop"],
				}),
			],
			true
		);
		expect(row.subject).not.toContain("hf_abcdefghijklmnop");
		expect(row.subject).toContain("<redacted>");
	});
});

describe("summarizeActivity", () => {
	it("counts calls with the same target together, in the order they first ran", () => {
		const tools = [
			done("crawling_exa", { url: "https://artificialanalysis.ai/models" }),
			done("web_search_exa", { query: "a" }),
			done("crawling_exa", { url: "https://arena.ai/leaderboard" }),
		];
		expect(summarizeActivity(tools)).toEqual({
			text: "Read 2 pages, searched the web",
			stopped: false,
		});
	});

	it("keeps web and Hub searches apart", () => {
		const tools = [
			done("web_search_exa", { query: "a" }),
			done("web_search_exa", { query: "b" }),
			done("hf_fs", { operations: [{ cmd: "search", args: ["hf://models", "tts"] }] }),
		];
		expect(summarizeActivity(tools).text).toBe("Ran 2 web searches, searched Hub models");
	});

	it("leaves a failed call to the rows, so a retry that worked reads as success", () => {
		const tools = [
			done("crawling_exa", { url: "https://artificialanalysis.ai/models" }),
			failing("crawling_exa", { url: "https://lmarena.ai/leaderboard" }),
			done("web_search_exa", { query: "x" }),
		];
		expect(summarizeActivity(tools)).toEqual({
			text: "Read artificialanalysis.ai, searched the web",
			stopped: false,
		});
	});

	it("says what was tried when every call failed", () => {
		expect(summarizeActivity([failing("web_search_exa", { query: "x" })]).text).toBe(
			"Couldn't search the web"
		);
		const twice = [
			failing("crawling_exa", { url: "https://x.com" }),
			failing("crawling_exa", { url: "https://x.com" }),
		];
		expect(summarizeActivity(twice).text).toBe("Couldn't read x.com ×2");
	});

	it("counts several uploads and marks calls the turn ended before", () => {
		const uploads = ["app.py", "requirements.txt", "README.md"].map((path) =>
			done("upload_file", { path_in_repo: path })
		);
		const stopped = activity([call("web_search_exa", { query: "x" })], false);
		expect(summarizeActivity([...uploads, stopped])).toMatchObject({
			text: "Uploaded 3 files, searched the web",
			stopped: true,
		});
	});
});

describe("steps", () => {
	it("folds identical consecutive calls into one row with a count", () => {
		const logs = (uuid: string) => ({
			type: "tool" as const,
			uuid,
			updates: [
				call("hf_jobs", { operation: "logs", args: { job_id: "j1" } }, uuid),
				ok("hf_jobs", uuid),
			],
		});
		const think = { type: "think" as const, content: "Wait for the job", closed: true };
		const collapsed = collapseSteps([logs("a"), logs("b"), logs("c"), think, logs("d")], false);
		expect(collapsed.map(({ block, count }) => [block.type, count])).toEqual([
			["tool", 3],
			["think", 1],
			["tool", 1],
		]);
	});

	it("calls a run of a few words of reasoning trivial", () => {
		expect(isTrivialThinking([{ type: "think", content: "Simple greeting.", closed: true }])).toBe(
			true
		);
		expect(isTrivialThinking([{ type: "think", content: "a".repeat(80), closed: true }])).toBe(
			false
		);
	});
});

describe("thinking labels", () => {
	it("formats how long a round reasoned", () => {
		expect(formatThought(400)).toBe("Thought briefly");
		expect(formatThought(12_400)).toBe("Thought for 12s");
		expect(formatThought(75_000)).toBe("Thought for 1m 15s");
	});

	it("takes the first sentence of reasoning, without filler", () => {
		expect(
			reasoningPreview("Okay, so the user wants a regex for UK postcodes. Let me think.")
		).toBe("The user wants a regex for UK postcodes");
		expect(reasoningPreview("   ")).toBeUndefined();
	});

	it("prefers the summary, then progress, then the time, then the reasoning itself", () => {
		const label = (
			round: number,
			phase: "thinking" | "summary" | "tools",
			text: string
		): MessageUpdate => ({ type: MessageUpdateType.ActivityLabel, round, phase, text });
		const timing = (round: number, thinkingMs: number): MessageUpdate => ({
			type: MessageUpdateType.ActivityTiming,
			round,
			thinkingMs,
		});
		const labels = activityLabels([
			label(0, "thinking", "Planning which leaderboards to check"),
			label(0, "summary", "Choosing primary leaderboards to check"),
			label(1, "thinking", "Comparing release dates"),
			timing(2, 9_000),
		]);
		expect(thoughtLabel(labels, 0, "x")).toBe("Choosing primary leaderboards to check");
		expect(thoughtLabel(labels, 1, "x")).toBe("Comparing release dates");
		expect(thoughtLabel(labels, 2, "x")).toBe("Thought for 9s");
		expect(thoughtLabel(labels, 3, "So, the dates conflict.")).toBe("The dates conflict");
		expect(labels.latest.get(0)?.text).toBe("Planning which leaderboards to check");
	});
});
