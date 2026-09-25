import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import { logger } from "$lib/server/logger";
import {
	composeGuards,
	type GuardedToolCall,
	type GuardOutcome,
	type ToolCallGuard,
} from "$lib/server/textGeneration/mcp/toolGuard";
import { MessageUpdateStatus, MessageUpdateType } from "$lib/types/MessageUpdate";
import { PARENT_READER } from "$lib/types/MlSource";
import { listMlSources } from "./sources";
import {
	crawledPages,
	createMlSourcesGuard,
	exaSearchResults,
	repoDetailsFound,
} from "./sourcesGuard";

beforeAll(async () => {
	await ready;
});

const conversationIds: ObjectId[] = [];

afterEach(async () => {
	vi.restoreAllMocks();
	await collections.mlSources.deleteMany({ conversationId: { $in: conversationIds } });
	conversationIds.length = 0;
});

const newConversationId = () => {
	const id = new ObjectId();
	conversationIds.push(id);
	return id;
};

const HF_URL = "https://hf.co/mcp?login";
const EXA_URL = "https://mcp.exa.ai/mcp";
const RUN_ID = "65f000000000000000000001";

const call = (
	tool: string,
	args: Record<string, unknown>,
	serverUrl = tool.endsWith("_exa") ? EXA_URL : HF_URL
): GuardedToolCall => ({ serverUrl, tool, fnName: tool, args, callUuid: "call-1" });

async function dispatch(guard: ToolCallGuard, toolCall: GuardedToolCall, outcome: GuardOutcome) {
	const verdict = await guard.before(toolCall);
	expect(verdict.allow).toBe(true);
	if (!verdict.allow || verdict.ticket === undefined) return undefined;
	return guard.after(verdict.ticket, outcome);
}

const ok = (text: string, structured?: unknown): GuardOutcome => ({
	status: "success",
	text,
	...(structured !== undefined ? { structured } : {}),
});

const PAPER_CONTENT =
	"Title: OmniParser V2: Structured-Points-of-Thought\n\nURL Source: https://arxiv.org/html/2502.16161\n\nMarkdown Content:\n...";

describe("hf_fs", () => {
	it("records every read in a batch, skips the listing and the failed read, titles a paper", async () => {
		const conversationId = newConversationId();
		const guard = createMlSourcesGuard({ conversationId, readBy: PARENT_READER });

		await dispatch(
			guard,
			call("hf_fs", {
				operations: [
					{ cmd: "cat", args: ["hf://papers/2502.16161/paper.md", "--max-bytes", "300"] },
					{ cmd: "ls", args: ["hf://docs/trl"] },
					{ cmd: "cat", args: ["hf://docs/trl/v1.14.0/sft_trainer.md"] },
					{ cmd: "attach", args: ["hf://datasets/pngwn/plots/loss.png"] },
					{ cmd: "cat", args: ["hf://models/pngwn/missing/README.md"] },
					{ cmd: "stat", args: ["hf://models/pngwn/demo/config.json"] },
				],
			}),
			ok("…", {
				results: [
					{
						index: 0,
						status: "success",
						result: { uri: "hf://papers/2502.16161/paper.md", op: "cat", content: PAPER_CONTENT },
					},
					{ index: 1, status: "success", result: { uri: "hf://docs/trl", op: "ls", entries: [] } },
					{
						index: 2,
						status: "success",
						result: {
							uri: "hf://docs/trl/v1.14.0/sft_trainer.md",
							op: "cat",
							content: "# SFT Trainer\n\nbody",
						},
					},
					{ index: 3, status: "success", result: { uri: "hf://datasets/pngwn/plots/loss.png" } },
					{
						index: 4,
						status: "error",
						error: { code: "HF_FS_NOT_FOUND", message: "ENOENT", retryable: false },
					},
					{ index: 5, status: "success", result: { op: "stat", exists: true } },
				],
			})
		);

		const rows = await listMlSources(conversationId);
		expect(
			rows.map(({ url, group, kind, opened, title }) => ({ url, group, kind, opened, title }))
		).toEqual([
			{
				url: "https://huggingface.co/papers/2502.16161",
				group: "Hugging Face papers",
				kind: "paper",
				opened: true,
				title: "OmniParser V2: Structured-Points-of-Thought",
			},
			{
				url: "https://huggingface.co/docs/trl/sft_trainer",
				group: "Hugging Face docs",
				kind: "docs",
				opened: true,
				title: "SFT Trainer",
			},
			{
				url: "https://huggingface.co/datasets/pngwn/plots/blob/main/loss.png",
				group: "pngwn/plots",
				kind: "hub",
				opened: true,
				title: undefined,
			},
		]);
		expect(rows.every((row) => row.readBy.join() === PARENT_READER)).toBe(true);
	});

	it("takes no title from a later page, and reads every uri when the reply has no structured part", async () => {
		const conversationId = newConversationId();
		const guard = createMlSourcesGuard({ conversationId, readBy: RUN_ID });

		await dispatch(
			guard,
			call("hf_fs", {
				operations: [
					{ cmd: "cat", args: ["hf://papers/2502.16161/paper.md", "--offset", "32000"] },
					{ cmd: "cat", args: ["hf://spaces/pngwn/demo/app.py"] },
				],
			}),
			ok("text only")
		);

		const rows = await listMlSources(conversationId);
		expect(rows.map((row) => [row.url, row.title, row.readBy])).toEqual([
			["https://huggingface.co/papers/2502.16161", undefined, [RUN_ID]],
			["https://huggingface.co/spaces/pngwn/demo/blob/main/app.py", undefined, [RUN_ID]],
		]);
	});

	it("counts two pages of one paper as two reads of one source", async () => {
		const conversationId = newConversationId();
		const guard = createMlSourcesGuard({ conversationId, readBy: PARENT_READER });
		await dispatch(
			guard,
			call("hf_fs", {
				operations: [
					{ cmd: "cat", args: ["hf://papers/2502.16161/paper.md"] },
					{ cmd: "cat", args: ["hf://papers/2502.16161/paper.md", "--offset", "80000"] },
				],
			}),
			ok("…")
		);
		const [row] = await listMlSources(conversationId);
		expect(row.count).toBe(2);
	});

	it("takes no interest in a batch with nothing read, or in another server's hf_fs", async () => {
		const conversationId = newConversationId();
		const guard = createMlSourcesGuard({ conversationId, readBy: PARENT_READER });
		expect(
			await guard.before(call("hf_fs", { operations: [{ cmd: "ls", args: ["hf://docs"] }] }))
		).toEqual({ allow: true });
		expect(
			await guard.before(
				call(
					"hf_fs",
					{ operations: [{ cmd: "cat", args: ["hf://papers/1/paper.md"] }] },
					"https://example.com/mcp"
				)
			)
		).toEqual({ allow: true });
	});
});

const SEARCH_TEXT = [
	"Title: TRL SFT Trainer docs\nURL: https://huggingface.co/docs/trl/sft_trainer\nPublished: 2026-01-01T00:00:00.000Z\nAuthor: N/A\nHighlights:\nSome text\nURL: https://ignored.example.com\n",
	"Title: A blog post\nURL: https://www.example.com/post#section\nPublished: N/A\nAuthor: N/A\nHighlights: ",
	"Title: No url here\nPublished: N/A",
	"Title: Bad scheme\nURL: javascript:alert(1)",
].join("\n---\n");

describe("Exa", () => {
	it("parses the search reply's blocks, first Title and URL each", () => {
		expect(exaSearchResults(SEARCH_TEXT)).toEqual([
			{ url: "https://huggingface.co/docs/trl/sft_trainer", title: "TRL SFT Trainer docs" },
			{ url: "https://www.example.com/post#section", title: "A blog post" },
			{ url: "javascript:alert(1)", title: "Bad scheme" },
		]);
	});

	it("records search results as found but not opened", async () => {
		const conversationId = newConversationId();
		const guard = createMlSourcesGuard({ conversationId, readBy: PARENT_READER });
		await dispatch(guard, call("web_search_exa", { query: "trl sft" }), ok(SEARCH_TEXT));

		const rows = await listMlSources(conversationId);
		expect(
			rows.map(({ url, group, kind, opened, title }) => [url, group, kind, opened, title])
		).toEqual([
			[
				"https://huggingface.co/docs/trl/sft_trainer",
				"huggingface.co",
				"web",
				false,
				"TRL SFT Trainer docs",
			],
			["https://www.example.com/post", "example.com", "web", false, "A blog post"],
		]);
	});

	it("reads code context results the same way, and prefers a structured result list", async () => {
		const conversationId = newConversationId();
		const guard = createMlSourcesGuard({ conversationId, readBy: PARENT_READER });
		await dispatch(
			guard,
			call("get_code_context_exa", { query: "SFTTrainer" }),
			ok("Title: Ignored\nURL: https://text.example.com/x", {
				results: [{ url: "https://github.com/huggingface/trl", title: "trl" }, { title: "no url" }],
			})
		);
		const rows = await listMlSources(conversationId);
		expect(rows.map((row) => [row.url, row.title, row.opened])).toEqual([
			["https://github.com/huggingface/trl", "trl", false],
		]);
	});

	it("records a crawled page as opened with its heading, and not one that failed", async () => {
		const text = [
			"# Migration Guide: v4 to v5",
			"URL: https://example.com/guide",
			"",
			"# A heading inside the page",
			"URL: https://example.com/not-requested",
			"Error fetching https://broken.example.com/x: CRAWL_NOT_FOUND",
		].join("\n");
		expect(
			crawledPages(text, ["https://example.com/guide", "https://broken.example.com/x"])
		).toEqual([{ url: "https://example.com/guide", title: "Migration Guide: v4 to v5" }]);

		const conversationId = newConversationId();
		const guard = createMlSourcesGuard({ conversationId, readBy: RUN_ID });
		await dispatch(
			guard,
			call("crawling_exa", {
				urls: ["https://example.com/guide", "https://broken.example.com/x"],
				maxCharacters: 5000,
			}),
			ok(text)
		);
		const rows = await listMlSources(conversationId);
		expect(rows.map((row) => [row.url, row.opened, row.title, row.readBy])).toEqual([
			["https://example.com/guide", true, "Migration Guide: v4 to v5", [RUN_ID]],
		]);
	});

	it("falls back to the requested urls minus failures when the reply spells none of them", () => {
		expect(
			crawledPages("Error fetching https://b.example.com: CRAWL_LIVECRAWL_TIMEOUT\nsome text", [
				"https://a.example.com",
				"https://b.example.com",
			])
		).toEqual([{ url: "https://a.example.com" }]);
	});

	it("upgrades a search hit once the page is crawled", async () => {
		const conversationId = newConversationId();
		const guard = createMlSourcesGuard({ conversationId, readBy: PARENT_READER });
		await dispatch(guard, call("web_search_exa", { query: "x" }), ok(SEARCH_TEXT));
		await dispatch(
			guard,
			call("crawling_exa", { urls: ["https://www.example.com/post"] }),
			ok("# A blog post\nURL: https://www.example.com/post\n\nbody")
		);
		const row = (await listMlSources(conversationId)).find(
			(source) => source.url === "https://www.example.com/post"
		);
		expect(row).toMatchObject({ opened: true, count: 2 });
	});

	it("ignores an Exa tool name on another server", async () => {
		const guard = createMlSourcesGuard({
			conversationId: newConversationId(),
			readBy: PARENT_READER,
		});
		expect(
			await guard.before(call("web_search_exa", { query: "x" }, "https://example.com/mcp"))
		).toEqual({ allow: true });
	});
});

const DETAILS_TEXT = `**Type: Dataset**

# HuggingFaceH4/ultrachat_200k

## Description
...

---

**Type: Model**

# openai/gpt-oss-20b

## Overview
- **Author:** openai`;

describe("hub_repo_details", () => {
	it("reads each repo's type from its block", () => {
		expect(repoDetailsFound(DETAILS_TEXT)).toEqual([
			{ id: "HuggingFaceH4/ultrachat_200k", type: "dataset" },
			{ id: "openai/gpt-oss-20b", type: "model" },
		]);
	});

	it("records the repos asked about, each under its own name", async () => {
		const conversationId = newConversationId();
		const guard = createMlSourcesGuard({ conversationId, readBy: PARENT_READER });
		await dispatch(
			guard,
			call("hub_repo_details", {
				repo_ids: ["huggingfaceh4/ultrachat_200k", "openai/gpt-oss-20b"],
			}),
			ok(DETAILS_TEXT)
		);
		const rows = await listMlSources(conversationId);
		expect(rows.map((row) => [row.url, row.group, row.kind, row.opened])).toEqual([
			[
				"https://huggingface.co/datasets/HuggingFaceH4/ultrachat_200k",
				"HuggingFaceH4/ultrachat_200k",
				"hub",
				true,
			],
			["https://huggingface.co/openai/gpt-oss-20b", "openai/gpt-oss-20b", "hub", true],
		]);
	});

	it("falls back to the given type when the reply cannot be read, and guesses none without one", async () => {
		const conversationId = newConversationId();
		const guard = createMlSourcesGuard({ conversationId, readBy: PARENT_READER });
		await dispatch(
			guard,
			call("hub_repo_details", { repo_ids: ["pngwn/demo"], repo_type: "space" }),
			ok("unexpected format")
		);
		await dispatch(
			guard,
			call("hub_repo_details", { repo_ids: ["pngwn/other"] }),
			ok("unexpected")
		);
		expect((await listMlSources(conversationId)).map((row) => row.url)).toEqual([
			"https://huggingface.co/spaces/pngwn/demo",
		]);
	});
});

describe("the guard", () => {
	it("records nothing for a call that failed", async () => {
		const conversationId = newConversationId();
		const guard = createMlSourcesGuard({ conversationId, readBy: PARENT_READER });
		const crawl = call("crawling_exa", { urls: ["https://example.com/a"] });
		for (const outcome of [
			{ status: "error", text: "boom" },
			{ status: "transport_error" },
			{ status: "elicited" },
		] as GuardOutcome[]) {
			await dispatch(guard, crawl, outcome);
		}
		expect(await listMlSources(conversationId)).toEqual([]);
	});

	it("never throws into the round when the write fails", async () => {
		const conversationId = newConversationId();
		const guard = createMlSourcesGuard({ conversationId, readBy: PARENT_READER });
		const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);
		vi.spyOn(collections.mlSources, "bulkWrite").mockRejectedValueOnce(new Error("db down"));

		await expect(
			dispatch(guard, call("crawling_exa", { urls: ["https://example.com/a"] }), ok("x"))
		).resolves.toBeUndefined();
		expect(error).toHaveBeenCalled();
	});

	it("sits ahead of a guard that emits updates without swallowing them", async () => {
		const conversationId = newConversationId();
		const update = {
			type: MessageUpdateType.Status,
			status: MessageUpdateStatus.KeepAlive,
		} as const;
		const last: ToolCallGuard = {
			allowParking: true,
			before: async () => ({ allow: true, ticket: "last" }),
			after: async () => update,
		};
		const chain = composeGuards(
			createMlSourcesGuard({ conversationId, readBy: PARENT_READER }),
			last
		);

		expect(
			await dispatch(chain, call("crawling_exa", { urls: ["https://example.com/a"] }), ok("x"))
		).toEqual(update);
		expect((await listMlSources(conversationId)).map((row) => row.url)).toEqual([
			"https://example.com/a",
		]);
	});
});
