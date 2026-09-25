import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import { ML_FILE_VERSION_INDEX } from "$lib/server/mlFiles/indexes";
import type { BuiltinToolContext, BuiltinToolResult } from "./types";

vi.mock("$lib/server/logger", () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { createFileTools } = await import("./fileTools");

const ctx: BuiltinToolContext = {
	uuid: "uuid-1",
	toolCallId: "call-1",
	messageId: "msg-1",
	generationId: "gen-1",
};

const SCRIPT = ["import torch", "", "lr = 1e-4", "steps = 100", "print(lr, steps)", ""].join("\n");

function tools() {
	const conv = { _id: new ObjectId() };
	const [write, edit, read] = createFileTools(conv);
	return { conv, write, edit, read };
}

const textOf = (outcome: BuiltinToolResult) =>
	"resultText" in outcome
		? outcome.resultText
		: `ERROR: ${"error" in outcome ? outcome.error : ""}`;

beforeAll(async () => {
	await ready;
	await collections.mlFiles.createIndex(ML_FILE_VERSION_INDEX.keys, ML_FILE_VERSION_INDEX.options);
});

afterEach(async () => {
	await collections.mlFiles.deleteMany({});
});

describe("write_file", () => {
	it("stores a version and answers with the shape, never the content", async () => {
		const { conv, write } = tools();

		const text = textOf(
			await write.execute({ name: "train.py", content: SCRIPT, summary: "v1" }, ctx)
		);

		expect(text).toContain("Wrote train.py v1");
		expect(text).toContain("5 lines");
		expect(text).toContain("v-file://train.py");
		expect(text).not.toContain("import torch");
		const stored = await collections.mlFiles.findOne({
			conversationId: conv._id,
			name: "train.py",
		});
		expect(stored).toMatchObject({
			version: 1,
			content: SCRIPT,
			origin: "write",
			summary: "v1",
			messageId: "msg-1",
			generationId: "gen-1",
			toolUuid: "uuid-1",
		});
	});

	it("records the sub-agent label when the call runs inside one", async () => {
		const { conv, write } = tools();

		await write.execute({ name: "train.py", content: "a" }, { ...ctx, agent: "sandbox" });

		const stored = await collections.mlFiles.findOne({ conversationId: conv._id });
		expect(stored).toMatchObject({ agent: "sandbox", messageId: "msg-1" });
	});

	it("bumps the version on a rewrite", async () => {
		const { write } = tools();
		await write.execute({ name: "train.py", content: "a" }, ctx);
		expect(textOf(await write.execute({ name: "train.py", content: "b" }, ctx))).toContain(
			"Wrote train.py v2"
		);
	});

	it("refuses a bad name, binary content and oversized content by name", async () => {
		const { write } = tools();
		expect(textOf(await write.execute({ name: "../x.py", content: "a" }, ctx))).toContain("ERROR");
		expect(textOf(await write.execute({ name: "x.py", content: "a\u0000" }, ctx))).toContain(
			"text only"
		);
		expect(
			textOf(await write.execute({ name: "x.py", content: "x".repeat(300 * 1024) }, ctx))
		).toContain("256 KB");
		expect(textOf(await write.execute({ content: "a" }, ctx))).toContain("Invalid write_file");
	});
});

describe("edit_file", () => {
	it("applies whitespace-tolerant edits and reports a diff, not the file", async () => {
		const { write, edit, read } = tools();
		await write.execute({ name: "train.py", content: SCRIPT }, ctx);

		const text = textOf(
			await edit.execute(
				{
					name: "train.py",
					edits: [
						{ old: "lr   =   1e-4", new: "lr = 1e-5" },
						{ old: "steps = 100", new: "steps = 200" },
					],
					summary: "lower lr",
					expected_version: 1,
				},
				ctx
			)
		);

		expect(text).toContain("train.py v2 (was v1): 2 edits applied");
		expect(text).toContain("-lr = 1e-4");
		expect(text).toContain("+lr = 1e-5");
		expect(text).not.toContain("import torch");
		const after = textOf(await read.execute({ name: "train.py" }, ctx));
		expect(after).toContain("3| lr = 1e-5");
		expect(after).toContain("4| steps = 200");
	});

	it("replaces the first occurrence only", async () => {
		const { write, edit, read } = tools();
		await write.execute({ name: "a.py", content: "x = 1\nx = 1\n" }, ctx);
		await edit.execute({ name: "a.py", edits: [{ old: "x = 1", new: "x = 2" }] }, ctx);
		expect(textOf(await read.execute({ name: "a.py" }, ctx))).toContain("1| x = 2\n2| x = 1");
	});

	it("refuses the whole call when one pair matches nothing, naming the pair", async () => {
		const { conv, write, edit } = tools();
		await write.execute({ name: "train.py", content: SCRIPT }, ctx);

		const text = textOf(
			await edit.execute(
				{
					name: "train.py",
					edits: [
						{ old: "lr = 1e-4", new: "lr = 1e-5" },
						{ old: "batch_size = 8", new: "batch_size = 4" },
					],
				},
				ctx
			)
		);

		expect(text).toContain("Edit 2 of 2 matched nothing in train.py v1");
		expect(text).toContain("batch_size = 8");
		expect(text).toContain("read_file");
		const versions = await collections.mlFiles.countDocuments({ conversationId: conv._id });
		expect(versions).toBe(1);
	});

	it("keeps one of two concurrent edits and refuses the other instead of losing it", async () => {
		const { conv, write, edit } = tools();
		await write.execute({ name: "train.py", content: "lr = 1\nsteps = 1\n" }, ctx);

		const outcomes = await Promise.all([
			edit.execute(
				{ name: "train.py", edits: [{ old: "lr = 1", new: "lr = 2" }], expected_version: 1 },
				ctx
			),
			edit.execute(
				{ name: "train.py", edits: [{ old: "steps = 1", new: "steps = 2" }], expected_version: 1 },
				ctx
			),
		]);

		const texts = outcomes.map(textOf);
		expect(texts.filter((text) => text.includes("v2 (was v1)"))).toHaveLength(1);
		// the loser either read v1 and lost the insert, or read after the winner wrote v2
		expect(texts.filter((text) => /moved from v1 to v2|is at v2, not v1/.test(text))).toHaveLength(
			1
		);
		const versions = await collections.mlFiles
			.find({ conversationId: conv._id })
			.sort({ version: 1 })
			.toArray();
		expect(versions.map((row) => row.version)).toEqual([1, 2]);
	});

	it("refuses a stale expected_version", async () => {
		const { write, edit } = tools();
		await write.execute({ name: "train.py", content: "a" }, ctx);
		await write.execute({ name: "train.py", content: "b" }, ctx);

		const text = textOf(
			await edit.execute(
				{ name: "train.py", edits: [{ old: "b", new: "c" }], expected_version: 1 },
				ctx
			)
		);

		expect(text).toContain("train.py is at v2, not v1");
	});

	it("names the files that exist when the name is unknown", async () => {
		const { write, edit } = tools();
		await write.execute({ name: "eval.py", content: "a" }, ctx);

		const text = textOf(
			await edit.execute({ name: "train.py", edits: [{ old: "a", new: "b" }] }, ctx)
		);

		expect(text).toContain('No virtual file named "train.py"');
		expect(text).toContain("eval.py (v1)");
	});
});

describe("read_file", () => {
	it("lists the conversation's files when called with no name", async () => {
		const { write, read } = tools();
		expect(textOf(await read.execute({}, ctx))).toContain("No virtual files");

		await write.execute({ name: "train.py", content: SCRIPT, summary: "first draft" }, ctx);
		await write.execute({ name: "train.py", content: SCRIPT + "x", summary: "second" }, ctx);
		await write.execute({ name: "eval.py", content: "e" }, ctx);

		const listing = textOf(await read.execute({}, ctx));
		expect(listing).toContain("Virtual files in this conversation (2)");
		expect(listing).toMatch(/eval\.py {2}v1 {2}1 bytes/);
		expect(listing).toMatch(/train\.py {2}v2 .*— second/);
		expect(listing).not.toContain("first draft");
	});

	it("numbers lines, honours a range and a pinned version", async () => {
		const { write, read } = tools();
		await write.execute({ name: "train.py", content: SCRIPT }, ctx);
		await write.execute({ name: "train.py", content: "v2 only" }, ctx);

		const ranged = textOf(
			await read.execute({ name: "train.py", version: 1, start_line: 3, end_line: 4 }, ctx)
		);
		expect(ranged).toContain("train.py v1 — lines 3-4 of 5");
		expect(ranged).toContain("3| lr = 1e-4\n4| steps = 100");
		expect(ranged).not.toContain("import torch");

		expect(textOf(await read.execute({ name: "train.py" }, ctx))).toContain("1| v2 only");
		expect(textOf(await read.execute({ name: "train.py", version: 9 }, ctx))).toContain(
			"versions run v1 to v2"
		);
		expect(textOf(await read.execute({ name: "nope.py" }, ctx))).toContain("No virtual file named");
	});

	it("caps the output and says how to page", async () => {
		const { write, read } = tools();
		const long = Array.from({ length: 2_000 }, (_, i) => `line ${i} ${"x".repeat(40)}`).join("\n");
		await write.execute({ name: "big.py", content: long }, ctx);

		const text = textOf(await read.execute({ name: "big.py" }, ctx));

		expect(text.length).toBeLessThan(41_000);
		expect(text).toMatch(/truncated at line (\d+) of 2000; call read_file with start_line=(\d+)/);
		const match = /truncated at line (\d+) of 2000; call read_file with start_line=(\d+)/.exec(
			text
		);
		expect(Number(match?.[2])).toBe(Number(match?.[1]) + 1);
	});
});
