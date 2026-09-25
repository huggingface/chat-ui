import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { config } from "$lib/server/config";
import { collections, ready } from "$lib/server/database";
import { resetGithubCache } from "$lib/server/github/client";
import { installGithubFetch, treeResponse } from "$lib/server/github/__fixtures__/mockFetch";
import { listMlSources } from "$lib/server/mlRegistry/sources";
import { PARENT_READER } from "$lib/types/MlSource";
import { githubGroundingBuiltins } from "./githubGrounding";
import type { BuiltinToolContext } from "./types";

const COMMIT = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const SHORT = COMMIT.slice(0, 7);
const RUN_ID = "65f000000000000000000001";

beforeAll(async () => {
	await ready;
});

let mock: ReturnType<typeof installGithubFetch> | undefined;
const conversationIds: ObjectId[] = [];

beforeEach(() => {
	const read = config.get.bind(config);
	vi.spyOn(config, "get").mockImplementation((key) =>
		key === "GITHUB_TOKEN" ? "ghp_test_token" : read(key)
	);
	resetGithubCache();
	mock = installGithubFetch(({ path }) => {
		if (path === "/repos/huggingface/trl") return { json: { default_branch: "main" } };
		if (path === "/repos/huggingface/trl/git/ref/heads/main") {
			return { json: { object: { sha: COMMIT } } };
		}
		if (path.startsWith(`/repos/huggingface/trl/git/trees/${COMMIT}`)) {
			return { json: treeResponse(["examples/scripts/sft.py", "examples/scripts/dpo.py"]) };
		}
		if (path.startsWith("/repos/huggingface/trl/contents/examples/scripts/sft.py")) {
			const text = "from trl import SFTTrainer\n";
			return {
				json: {
					type: "file",
					encoding: "base64",
					size: text.length,
					content: Buffer.from(text).toString("base64"),
				},
			};
		}
		return undefined;
	});
});

afterEach(async () => {
	vi.restoreAllMocks();
	mock?.restore();
	mock = undefined;
	await collections.mlSources.deleteMany({ conversationId: { $in: conversationIds } });
	conversationIds.length = 0;
});

const newConversationId = () => {
	const id = new ObjectId();
	conversationIds.push(id);
	return id;
};

const ctx = (over: Partial<BuiltinToolContext> = {}): BuiltinToolContext => ({
	uuid: "u1",
	toolCallId: "c1",
	...over,
});

const tool = (name: string, conversationId?: ObjectId) => {
	const found = githubGroundingBuiltins(conversationId).find((t) => t.name === name);
	if (!found) throw new Error(`${name} was not offered`);
	return found;
};

describe("GitHub sources", () => {
	it("records a file the parent read as opened, grouped by repo", async () => {
		const conversationId = newConversationId();
		const result = await tool("github_read_file", conversationId).execute(
			{ repo: "trl", path: "examples/scripts/sft.py" },
			ctx()
		);
		expect(result).toMatchObject({ resultText: expect.stringContaining("SFTTrainer") });

		const rows = await listMlSources(conversationId);
		expect(
			rows.map(({ url, group, kind, opened, readBy }) => ({ url, group, kind, opened, readBy }))
		).toEqual([
			{
				url: "https://github.com/huggingface/trl/blob/HEAD/examples/scripts/sft.py",
				group: "huggingface/trl",
				kind: "github",
				opened: true,
				readBy: [PARENT_READER],
			},
		]);
	});

	it("records what a sub-agent found as listed, and its later read of one as opened", async () => {
		const conversationId = newConversationId();
		await tool("github_find_examples", conversationId).execute(
			{ repo: "huggingface/trl", keyword: "sft" },
			ctx({ agentRunId: RUN_ID })
		);
		const listed = await listMlSources(conversationId);
		expect(listed.map(({ url, opened, readBy }) => ({ url, opened, readBy }))).toContainEqual({
			url: `https://github.com/huggingface/trl/blob/${SHORT}/examples/scripts/sft.py`,
			opened: false,
			readBy: [RUN_ID],
		});

		await tool("github_read_file", conversationId).execute(
			{ repo: "huggingface/trl", path: "examples/scripts/sft.py", ref: SHORT },
			ctx({ agentRunId: RUN_ID })
		);
		const read = (await listMlSources(conversationId)).find((row) =>
			row.url.endsWith("/examples/scripts/sft.py")
		);
		expect(read).toMatchObject({ opened: true, count: 2, readBy: [RUN_ID] });
	});

	it("records nothing for a failed read or without a conversation", async () => {
		const conversationId = newConversationId();
		const failed = await tool("github_read_file", conversationId).execute(
			{ repo: "trl", path: "missing.py" },
			ctx()
		);
		expect(failed).toHaveProperty("error");
		expect(await listMlSources(conversationId)).toEqual([]);

		const unbound = await tool("github_read_file").execute(
			{ repo: "trl", path: "examples/scripts/sft.py" },
			ctx()
		);
		expect(unbound).toHaveProperty("resultText");
	});

	it("still answers when the write fails", async () => {
		const conversationId = newConversationId();
		vi.spyOn(collections.mlSources, "bulkWrite").mockRejectedValueOnce(new Error("db down"));
		const result = await tool("github_read_file", conversationId).execute(
			{ repo: "trl", path: "examples/scripts/sft.py" },
			ctx()
		);
		expect(result).toHaveProperty("resultText");
	});
});
