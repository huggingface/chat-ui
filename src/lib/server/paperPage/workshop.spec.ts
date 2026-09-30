import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { spawnSync } from "child_process";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import {
	attachmentFileName,
	containerPath,
	fetchWithRetry,
	parseHubFileRef,
	parseStagedChanges,
	publishTargetError,
	shellQuote,
	spaceCard,
	spaceHost,
	userHasReplied,
} from "./workshop";

describe("spaceHost", () => {
	it("derives the hf.space host the way the Hub does", () => {
		expect(spaceHost("blanchon/mamba-dev")).toBe("blanchon-mamba-dev.hf.space");
		expect(spaceHost("Org_Name/My.Page-dev")).toBe("org-name-my-page-dev.hf.space");
	});
});

describe("containerPath", () => {
	it("resolves relative paths under the project", () => {
		expect(containerPath("src/routes/+page.svelte")).toBe("/app/src/routes/+page.svelte");
		expect(containerPath("./static/fig.svg")).toBe("/app/static/fig.svg");
	});

	it("keeps absolute paths", () => {
		expect(containerPath("/tmp/dev.log")).toBe("/tmp/dev.log");
	});
});

describe("spaceCard", () => {
	it("keeps a valid card", () => {
		expect(
			spaceCard(
				{
					title: "Mamba",
					emoji: "🐍",
					colorFrom: "green",
					colorTo: "yellow",
					shortDescription: "Linear-time sequence modeling",
				},
				"mamba"
			)
		).toEqual({
			title: "Mamba",
			emoji: "🐍",
			colorFrom: "green",
			colorTo: "yellow",
			shortDescription: "Linear-time sequence modeling",
		});
	});

	it("falls back to what the Hub accepts", () => {
		const card = spaceCard(
			{ emoji: "not an emoji", colorFrom: "emerald", shortDescription: "x".repeat(100) },
			"mamba"
		);
		expect(card.title).toBe("mamba");
		expect(card.emoji).toBe("📄");
		expect(card.colorFrom).toBe("indigo");
		expect(card.shortDescription).toHaveLength(60);
	});
});

describe("fetchWithRetry", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it("waits out a 429 and returns the retried response", async () => {
		vi.useFakeTimers();
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response("slow down", { status: 429, headers: { "retry-after": "1" } })
			)
			.mockResolvedValueOnce(new Response("ok", { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		const pending = fetchWithRetry("https://x.hf.space/__sbx/v1/exec");
		await vi.advanceTimersByTimeAsync(1_000);
		const res = await pending;

		expect(res.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("retries a request the server never read (408)", async () => {
		vi.useFakeTimers();
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response("timed out reading the request head", { status: 408 }))
			.mockResolvedValueOnce(new Response("ok", { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		const pending = fetchWithRetry("https://x.hf.space/__sbx/v1/exec", {
			method: "POST",
			body: "{}",
		});
		await vi.advanceTimersByTimeAsync(2_000);

		expect((await pending).status).toBe(200);
	});

	it("gives up after three retries", async () => {
		vi.useFakeTimers();
		const fetchMock = vi.fn().mockImplementation(async () => new Response("", { status: 429 }));
		vi.stubGlobal("fetch", fetchMock);

		const pending = fetchWithRetry("https://x.hf.space/__sbx/v1/exec");
		await vi.advanceTimersByTimeAsync(20_000);

		expect((await pending).status).toBe(429);
		expect(fetchMock).toHaveBeenCalledTimes(4);
	});
});

describe("parseStagedChanges", () => {
	const entry = (src: string, dst: string, status: string, path: string) =>
		`:${src} ${dst} ${"a".repeat(40)} ${"b".repeat(40)} ${status}\0${path}\0`;

	it("sorts additions, edits and deletions, and skips symlinks", () => {
		const raw =
			entry("000000", "100644", "A", "src/routes/+page.svelte") +
			entry("100644", "100644", "M", "static/fig one.svg") +
			entry("100644", "000000", "D", "old\nname.txt") +
			entry("000000", "120000", "A", "leak");
		expect(parseStagedChanges(raw)).toEqual({
			upserts: ["src/routes/+page.svelte", "static/fig one.svg"],
			deletes: ["old\nname.txt"],
			skipped: ["leak"],
		});
	});

	it("is empty when nothing changed", () => {
		expect(parseStagedChanges("")).toEqual({ upserts: [], deletes: [], skipped: [] });
	});
});

describe("publishTargetError", () => {
	const workshop = { spaceId: "alice/mamba-dev", host: "alice-mamba-dev.hf.space", sbxToken: "t" };

	it("accepts a new Space of the owner, or the one already published", () => {
		expect(publishTargetError("alice/mamba", workshop)).toBeUndefined();
		expect(publishTargetError("alice/mamba", workshop, "alice/mamba")).toBeUndefined();
	});

	it("refuses other owners, the workshop itself, a move, and malformed ids", () => {
		expect(publishTargetError("bob/mamba", workshop)).toMatch(/alice\//);
		expect(publishTargetError("alice/mamba-dev", workshop)).toMatch(/workshop itself/);
		expect(publishTargetError("alice/other", workshop, "alice/mamba")).toMatch(/cannot be moved/);
		expect(publishTargetError("alice/a/b", workshop)).toMatch(/not a Space id/);
	});
});

describe("attachmentFileName", () => {
	it("keeps the base name, sanitised, and never a dot-only name", () => {
		const taken = new Set<string>();
		expect(attachmentFileName("../../etc/my paper.pdf", taken)).toBe("my_paper.pdf");
		expect(attachmentFileName("..", taken)).toBe("file");
	});

	it("suffixes a name already used", () => {
		const taken = new Set<string>();
		expect(attachmentFileName("paper.pdf", taken)).toBe("paper.pdf");
		expect(attachmentFileName("paper.pdf", taken)).toBe("paper-2.pdf");
	});
});

describe("shellQuote", () => {
	it("passes $, backticks and quotes through the shell unchanged", () => {
		const message = `Fix $PATH, \`date\` and "it's" \\n`;
		const echoed = spawnSync("sh", ["-c", `printf %s ${shellQuote(message)}`]).stdout.toString();
		expect(echoed).toBe(message);
	});
});

describe("parseHubFileRef", () => {
	it("reads hf:// URIs of buckets and repos", () => {
		expect(parseHubFileRef("hf://buckets/alice/mamba-media/videos/teaser.mp4")).toEqual({
			repo: { type: "bucket", name: "alice/mamba-media" },
			path: "videos/teaser.mp4",
		});
		expect(parseHubFileRef("hf://datasets/alice/data/demo.mp4")?.repo).toEqual({
			type: "dataset",
			name: "alice/data",
		});
		expect(parseHubFileRef("hf://alice/model/weights.bin")?.repo.type).toBe("model");
	});

	it("reads resolve and blob URLs, with the revision for repos", () => {
		expect(
			parseHubFileRef("https://huggingface.co/buckets/alice/mamba-media/resolve/paper%20v2.pdf")
		).toEqual({ repo: { type: "bucket", name: "alice/mamba-media" }, path: "paper v2.pdf" });
		expect(
			parseHubFileRef("https://huggingface.co/datasets/alice/data/blob/main/clips/a.mp4")
		).toEqual({
			repo: { type: "dataset", name: "alice/data" },
			revision: "main",
			path: "clips/a.mp4",
		});
	});

	it("rejects anything else", () => {
		expect(parseHubFileRef("https://example.com/paper.pdf")).toBeUndefined();
		expect(parseHubFileRef("hf://buckets/alice")).toBeUndefined();
	});
});

describe("userHasReplied", () => {
	beforeAll(async () => {
		await ready;
	});

	async function conversation(fromUser: number) {
		const { insertedId } = await collections.conversations.insertOne({
			_id: new ObjectId(),
			messages: Array.from({ length: fromUser }, (_, i) => ({
				id: `m${i}`,
				from: "user",
				content: "hi",
			})),
		} as never);
		return insertedId;
	}

	it("is false on the first message alone, true once the user wrote again", async () => {
		expect(await userHasReplied(await conversation(1))).toBe(false);
		expect(await userHasReplied(await conversation(2))).toBe(true);
	});

	it("is true once the user answered a question", async () => {
		const id = await conversation(1);
		await collections.mcpElicitations.insertOne({
			_id: new ObjectId(),
			elicitationId: new ObjectId().toString(),
			conversationId: id,
			status: "resolved",
			action: "accept",
		} as never);
		expect(await userHasReplied(id)).toBe(true);
	});
});
