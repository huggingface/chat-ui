import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import { PARENT_READER } from "$lib/types/MlSource";
import {
	DOCS_GROUP,
	PAPERS_GROUP,
	countSourcesReadBy,
	hfSighting,
	hubRepoSighting,
	listMlSources,
	recordSources,
	webSighting,
} from "./sources";

beforeAll(async () => {
	await ready;
});

const conversationIds: ObjectId[] = [];

afterEach(async () => {
	await collections.mlSources.deleteMany({ conversationId: { $in: conversationIds } });
	conversationIds.length = 0;
});

const newConversationId = () => {
	const id = new ObjectId();
	conversationIds.push(id);
	return id;
};

const RUN_ID = "65f000000000000000000001";

describe("hfSighting", () => {
	it("maps any read inside a paper to the paper's page", () => {
		expect(hfSighting("hf://papers/2502.16161/paper.md", { opened: true })).toEqual({
			url: "https://huggingface.co/papers/2502.16161",
			group: PAPERS_GROUP,
			kind: "paper",
			opened: true,
		});
		expect(hfSighting("hf://papers/2502.16161/metadata.json", { opened: true })?.url).toBe(
			"https://huggingface.co/papers/2502.16161"
		);
	});

	it("maps a docs page to the site, dropping the release, the extension and any anchor", () => {
		expect(
			hfSighting("hf://docs/trl/v1.14.0/peft_integration.md#supervised-fine-tuning-sft", {
				opened: true,
			})
		).toEqual({
			url: "https://huggingface.co/docs/trl/peft_integration",
			group: DOCS_GROUP,
			kind: "docs",
			opened: true,
		});
		expect(
			hfSighting("hf://docs/transformers/v5.17.0/main_classes/trainer.md", { opened: true })?.url
		).toBe("https://huggingface.co/docs/transformers/main_classes/trainer");
		expect(hfSighting("hf://docs/hub/repositories.md", { opened: true })?.url).toBe(
			"https://huggingface.co/docs/hub/repositories"
		);
		expect(hfSighting("hf://docs/trl/v2_migration.md", { opened: true })?.url).toBe(
			"https://huggingface.co/docs/trl/v2_migration"
		);
	});

	it("maps a Hub file to its blob page, grouped by repo", () => {
		expect(
			hfSighting("hf://datasets/HuggingFaceH4/ultrachat_200k/data/README.md", { opened: true })
		).toEqual({
			url: "https://huggingface.co/datasets/HuggingFaceH4/ultrachat_200k/blob/main/data/README.md",
			group: "HuggingFaceH4/ultrachat_200k",
			kind: "hub",
			opened: true,
		});
		expect(
			hfSighting("hf://models/openai/gpt-oss-20b@abc123/config.json", { opened: true })?.url
		).toBe("https://huggingface.co/openai/gpt-oss-20b/blob/abc123/config.json");
		expect(hfSighting("hf://spaces/pngwn/demo/app.py", { opened: true })?.url).toBe(
			"https://huggingface.co/spaces/pngwn/demo/blob/main/app.py"
		);
	});

	it("keeps a title it is given and ignores buckets and anything unparseable", () => {
		expect(
			hfSighting("hf://papers/2502.16161/paper.md", { opened: true, title: "  OmniParser  V2 " })
				?.title
		).toBe("OmniParser V2");
		expect(hfSighting("hf://buckets/pngwn/scratch/out.json", { opened: true })).toBeUndefined();
		expect(hfSighting("hf://collections/pngwn/abc", { opened: true })).toBeUndefined();
		expect(hfSighting("not a uri", { opened: true })).toBeUndefined();
	});
});

describe("webSighting", () => {
	it("groups by host without www, and links without the fragment or any credentials", () => {
		expect(
			webSighting("https://user:secret@www.Example.com/a/b?x=1#frag", {
				opened: false,
				title: "A page",
			})
		).toEqual({
			url: "https://www.example.com/a/b?x=1",
			group: "example.com",
			kind: "web",
			opened: false,
			title: "A page",
		});
	});

	it("keeps only http and https, since the pane links to it", () => {
		expect(webSighting("http://arxiv.org/abs/1", { opened: true })?.group).toBe("arxiv.org");
		expect(webSighting("javascript:alert(1)", { opened: true })).toBeUndefined();
		expect(webSighting("ftp://example.com/x", { opened: true })).toBeUndefined();
		expect(webSighting("not a url", { opened: true })).toBeUndefined();
		expect(
			webSighting(`https://example.com/${"a".repeat(3000)}`, { opened: true })
		).toBeUndefined();
	});

	it("cuts a long title", () => {
		const title = webSighting("https://example.com", {
			opened: true,
			title: "t".repeat(500),
		})?.title;
		expect(title).toHaveLength(201);
	});
});

describe("hubRepoSighting", () => {
	it("links a repo's own page by type", () => {
		expect(hubRepoSighting("dataset", "HuggingFaceH4/ultrachat_200k")).toEqual({
			url: "https://huggingface.co/datasets/HuggingFaceH4/ultrachat_200k",
			group: "HuggingFaceH4/ultrachat_200k",
			kind: "hub",
			opened: true,
		});
		expect(hubRepoSighting("model", "openai/gpt-oss-20b")?.url).toBe(
			"https://huggingface.co/openai/gpt-oss-20b"
		);
		expect(hubRepoSighting("space", "not-a-repo-id")).toBeUndefined();
	});
});

describe("recordSources", () => {
	const page = (opened: boolean, title?: string) => ({
		url: "https://example.com/post",
		group: "example.com",
		kind: "web" as const,
		opened,
		...(title ? { title } : {}),
	});

	it("inserts one row per url and counts every sighting", async () => {
		const conversationId = newConversationId();
		await recordSources(conversationId, PARENT_READER, [page(false, "Post"), page(false)]);

		const [row, ...rest] = await listMlSources(conversationId);
		expect(rest).toEqual([]);
		expect(row).toMatchObject({
			url: "https://example.com/post",
			group: "example.com",
			kind: "web",
			opened: false,
			title: "Post",
			readBy: [PARENT_READER],
			openedBy: [],
			count: 2,
		});
		expect(row.firstSeenAt).toBeInstanceOf(Date);
	});

	it("upgrades opened and never downgrades it", async () => {
		const conversationId = newConversationId();
		await recordSources(conversationId, PARENT_READER, [page(false)]);
		await recordSources(conversationId, PARENT_READER, [page(true)]);
		expect((await listMlSources(conversationId))[0].opened).toBe(true);

		await recordSources(conversationId, PARENT_READER, [page(false)]);
		const [row] = await listMlSources(conversationId);
		expect(row.opened).toBe(true);
		expect(row.count).toBe(3);
	});

	it("credits the open to the reader that opened it, not one that only found it", async () => {
		const conversationId = newConversationId();
		await recordSources(conversationId, PARENT_READER, [page(false)]);
		await recordSources(conversationId, RUN_ID, [page(true)]);
		await recordSources(conversationId, PARENT_READER, [page(false)]);

		const [row] = await listMlSources(conversationId);
		expect(row.opened).toBe(true);
		expect(row.readBy).toEqual([PARENT_READER, RUN_ID]);
		expect(row.openedBy).toEqual([RUN_ID]);
	});

	it("keeps each reader once and moves lastSeenAt", async () => {
		const conversationId = newConversationId();
		await recordSources(conversationId, PARENT_READER, [page(true)]);
		const first = (await listMlSources(conversationId))[0];
		await new Promise((resolve) => setTimeout(resolve, 5));
		await recordSources(conversationId, RUN_ID, [page(true)]);
		await recordSources(conversationId, PARENT_READER, [page(true)]);

		const [row] = await listMlSources(conversationId);
		expect(row.readBy).toEqual([PARENT_READER, RUN_ID]);
		expect(row.firstSeenAt).toEqual(first.firstSeenAt);
		expect(row.lastSeenAt.getTime()).toBeGreaterThan(first.lastSeenAt.getTime());
		expect(await countSourcesReadBy(conversationId, RUN_ID)).toBe(1);
	});

	it("keeps the last title given and one conversation's rows away from another's", async () => {
		const conversationId = newConversationId();
		const other = newConversationId();
		await recordSources(conversationId, PARENT_READER, [page(false, "Old")]);
		await recordSources(conversationId, PARENT_READER, [page(true)]);
		expect((await listMlSources(conversationId))[0].title).toBe("Old");
		await recordSources(conversationId, PARENT_READER, [page(true, "New")]);
		expect((await listMlSources(conversationId))[0].title).toBe("New");
		expect(await listMlSources(other)).toEqual([]);
	});

	it("survives two calls racing to insert the same url", async () => {
		const conversationId = newConversationId();
		await Promise.all([
			recordSources(conversationId, PARENT_READER, [page(false)]),
			recordSources(conversationId, RUN_ID, [page(true)]),
		]);
		const rows = await listMlSources(conversationId);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ opened: true, count: 2 });
		expect([...rows[0].readBy].sort()).toEqual([RUN_ID, PARENT_READER].sort());
	});

	it("writes nothing for an empty call", async () => {
		const conversationId = newConversationId();
		await recordSources(conversationId, PARENT_READER, []);
		expect(await listMlSources(conversationId)).toEqual([]);
	});
});
