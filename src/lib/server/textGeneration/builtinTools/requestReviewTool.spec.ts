import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import { ML_FILE_VERSION_INDEX } from "$lib/server/mlFiles/indexes";
import { writeMlFileVersion } from "$lib/server/mlFiles/store";
import type { MessageUpdate } from "$lib/types/MessageUpdate";
import { MessageReviewUpdateType, MessageUpdateType } from "$lib/types/MessageUpdate";
import type { BuiltinToolContext, BuiltinToolResult } from "./types";

vi.mock("$lib/server/logger", () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("$lib/server/mcp/clientPool", () => ({ getClient: vi.fn(async () => ({})) }));
vi.mock("$lib/server/mlFiles/remoteRead", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/server/mlFiles/remoteRead")>()),
	readSandboxPage: vi.fn(),
	readHubPage: vi.fn(),
}));

const { readHubPage, readSandboxPage } = await import("$lib/server/mlFiles/remoteRead");
const { createRequestReviewTool } = await import("./requestReviewTool");

const HUB = { name: "Hugging Face", url: "https://hf.co/mcp?login" };
const HANDLE = "hfsb2:pngwn:6a99a386e686246ca699f46f";

const FIELDS = [
	{ name: "title", type: "text" },
	{ name: "body", type: "markdown" },
	{ name: "labels", type: "json" },
];
const QUESTIONS = [
	{
		name: "kind",
		type: "label",
		required: true,
		options: [{ value: "bug" }, { value: "feature" }, { value: "question" }],
	},
	{ name: "severity", type: "rating", min: 1, max: 5 },
];
const record = (i: number) => ({
	id: `gh-${i}`,
	title: `Issue ${i}`,
	body: `Body ${i}`,
	labels: ["bug"],
});
const records = (n: number) => Array.from({ length: n }, (_, i) => record(i + 1));
const jsonl = (n: number) =>
	records(n)
		.map((r) => JSON.stringify(r))
		.join("\n");

function setup({ sink = true }: { sink?: boolean } = {}) {
	const conv = { _id: new ObjectId() };
	const emitted: MessageUpdate[] = [];
	const tool = createRequestReviewTool(conv);
	tool.bind({
		openai: {} as never,
		completionBase: { model: "m", stream: true },
		requestHeaders: {},
		servers: [HUB],
		mapping: {},
		mcpTools: [],
		hostBuiltinTools: [],
	});
	const ctx: BuiltinToolContext = {
		uuid: "uuid-1",
		toolCallId: "call-1",
		messageId: "msg-1",
		generationId: "gen-1",
		conversationId: conv._id,
		...(sink
			? {
					elicitationSink: {
						conversationId: conv._id,
						generationId: "gen-1",
						emit: (u: MessageUpdate) => emitted.push(u),
					},
				}
			: {}),
	};
	const run = (args: Record<string, unknown>) => tool.execute(args, ctx);
	return { conv, tool, ctx, emitted, run };
}

const errorOf = (outcome: BuiltinToolResult) => ("error" in outcome ? outcome.error : "");

const page = (content: string) => ({ content, truncated: false });

beforeAll(async () => {
	await ready;
	await collections.mlFiles.createIndex(ML_FILE_VERSION_INDEX.keys, ML_FILE_VERSION_INDEX.options);
});

beforeEach(() => {
	vi.mocked(readSandboxPage).mockReset();
	vi.mocked(readHubPage).mockReset();
});

afterEach(async () => {
	await Promise.all([
		collections.mlFiles.deleteMany({}),
		collections.mlReviews.deleteMany({}),
		collections.mcpElicitations.deleteMany({}),
		collections.turnStates.deleteMany({}),
	]);
});

describe("request_review parks the turn", () => {
	it("snapshots the records, records a review elicitation and waits for the user", async () => {
		const { conv, emitted, run } = setup();
		const outcome = await run({
			title: "Triage batch 1",
			source: { records: records(3) },
			fields: FIELDS,
			questions: QUESTIONS,
			suggestions: "after_answer",
		});
		expect(outcome).toEqual({ awaitingInput: true });

		const review = await collections.mlReviews.findOne({ conversationId: conv._id });
		expect(review).toMatchObject({
			messageId: "msg-1",
			toolCallId: "call-1",
			toolUuid: "uuid-1",
			status: "open",
			source: { kind: "inline" },
			schema: { title: "Triage batch 1", idField: "id", suggestions: "after_answer" },
			drafts: {},
		});
		expect(review?.records.map((r) => r.id)).toEqual(["gh-1", "gh-2", "gh-3"]);
		expect(review?.schemaHash).toMatch(/^[0-9a-f]{8}$/);

		const row = await collections.mcpElicitations.findOne({ conversationId: conv._id });
		expect(row).toMatchObject({
			elicitationId: review?.elicitationId,
			status: "pending",
			generationId: "gen-1",
			pending: {
				kind: "review",
				reviewId: review?._id.toString(),
				messageId: "msg-1",
				toolCallId: "call-1",
				toolUuid: "uuid-1",
			},
			request: { mode: "form", message: "Triage batch 1" },
		});
		expect(row?.request.fields).toBeUndefined();
		expect(row?.expiresAt).toBeUndefined();

		expect(emitted[0]).toEqual({
			type: MessageUpdateType.Review,
			subtype: MessageReviewUpdateType.Request,
			reviewId: review?._id.toString(),
			toolUuid: "uuid-1",
			title: "Triage batch 1",
			records: 3,
			questions: 2,
			mode: "label",
		});
		expect(emitted[1]).toMatchObject({
			type: MessageUpdateType.TurnState,
			state: "awaiting_input",
		});
		const state = await collections.turnStates.findOne({ conversationId: conv._id });
		expect(state?.status).toBe("awaiting_input");
	});

	it("calls a batch with no required question a plain review", async () => {
		const { emitted, run } = setup();
		await run({ title: "Look", source: { records: records(2) }, fields: FIELDS });
		expect(emitted[0]).toMatchObject({ questions: 0, mode: "review" });
	});

	it("refuses without a chat to show it in, as in a sub-agent run, and writes nothing", async () => {
		const { conv, run } = setup({ sink: false });
		const outcome = await run({ title: "T", source: { records: records(2) }, fields: FIELDS });
		expect(errorOf(outcome)).toContain("there is no chat to show the review in");
		expect(await collections.mlReviews.countDocuments({ conversationId: conv._id })).toBe(0);
		expect(await collections.mcpElicitations.countDocuments({ conversationId: conv._id })).toBe(0);
	});
});

describe("request_review sources", () => {
	it("takes at most 20 records inline and points at a file beyond that", async () => {
		const { conv, run } = setup();
		expect(await run({ title: "T", source: { records: records(20) }, fields: FIELDS })).toEqual({
			awaitingInput: true,
		});
		const outcome = await run({ title: "T", source: { records: records(21) }, fields: FIELDS });
		expect(errorOf(outcome)).toMatch(
			/21 records inline .* write them to a file and pass source\.file/
		);
		expect(await collections.mlReviews.countDocuments({ conversationId: conv._id })).toBe(1);
	});

	it("reads a virtual file, latest or pinned, as JSONL or a JSON array", async () => {
		const { conv, run } = setup();
		await writeMlFileVersion({
			conversationId: conv._id,
			name: "triage/batch.jsonl",
			content: jsonl(30),
			origin: "write",
		});
		await writeMlFileVersion({
			conversationId: conv._id,
			name: "triage/batch.jsonl",
			content: JSON.stringify(records(5)),
			origin: "write",
		});
		await run({ title: "Latest", source: { file: "triage/batch.jsonl" }, fields: FIELDS });
		await run({ title: "Pinned", source: { file: "triage/batch.jsonl@1" }, fields: FIELDS });
		const reviews = await collections.mlReviews
			.find({ conversationId: conv._id })
			.sort({ createdAt: 1 })
			.toArray();
		expect(reviews.map((r) => [r.records.length, r.source])).toEqual([
			[5, { kind: "file", name: "triage/batch.jsonl", version: 2 }],
			[30, { kind: "file", name: "triage/batch.jsonl", version: 1 }],
		]);
	});

	it("reads a sandbox file through the paged reader", async () => {
		const { conv, run } = setup();
		vi.mocked(readSandboxPage).mockResolvedValueOnce(page(jsonl(4)));
		const outcome = await run({
			title: "Sandbox sample",
			source: { sandbox: { handle: HANDLE, path: "/work/sample.jsonl" } },
			fields: FIELDS,
		});
		expect(outcome).toEqual({ awaitingInput: true });
		const [server, source, offset, , outcomeText] = vi.mocked(readSandboxPage).mock.calls[0];
		expect([server, source, offset, outcomeText]).toEqual([
			HUB,
			{ handle: HANDLE, path: "/work/sample.jsonl" },
			0,
			"no review was opened",
		]);
		const review = await collections.mlReviews.findOne({ conversationId: conv._id });
		expect(review?.source).toEqual({
			kind: "sandbox",
			handle: HANDLE,
			path: "/work/sample.jsonl",
		});
		expect(review?.records).toHaveLength(4);
	});

	it("reads an hf:// file through the paged reader", async () => {
		const { conv, run } = setup();
		const uri = "hf://datasets/org/repo/sample.jsonl";
		vi.mocked(readHubPage).mockResolvedValueOnce(page(jsonl(6)));
		expect(await run({ title: "Hub", source: { hub: uri }, fields: FIELDS })).toEqual({
			awaitingInput: true,
		});
		expect(vi.mocked(readHubPage).mock.calls[0].slice(0, 3)).toEqual([HUB, uri, 0]);
		const review = await collections.mlReviews.findOne({ conversationId: conv._id });
		expect(review?.source).toEqual({ kind: "hub", uri });
		expect(review?.records).toHaveLength(6);
	});

	it("passes a reader's refusal on to the model", async () => {
		const { run } = setup();
		vi.mocked(readHubPage).mockResolvedValueOnce({ error: "hf_fs could not read it: 404" });
		const outcome = await run({
			title: "Hub",
			source: { hub: "hf://datasets/org/repo/missing.jsonl" },
			fields: FIELDS,
		});
		expect(errorOf(outcome)).toContain("hf_fs could not read it: 404");
	});

	it("reads the declaration from a schema file the model wrote", async () => {
		const { conv, run } = setup();
		await writeMlFileVersion({
			conversationId: conv._id,
			name: "triage/schema.json",
			content: JSON.stringify({ fields: FIELDS, questions: QUESTIONS }),
			origin: "write",
		});
		expect(
			await run({
				title: "Batch 2",
				source: { records: records(2) },
				schema: "triage/schema.json",
			})
		).toEqual({ awaitingInput: true });
		const review = await collections.mlReviews.findOne({ conversationId: conv._id });
		expect(review?.schema.questions.map((q) => q.name)).toEqual(["kind", "severity"]);
	});
});

describe("request_review csv and tsv sources", () => {
	const TABLE_FIELDS = [
		{ name: "title", type: "text" },
		{ name: "body", type: "markdown" },
		{ name: "score", type: "number" },
	];

	it("reads a csv virtual file, quoted multi-line bodies included, with typed cells", async () => {
		const { conv, run } = setup();
		await writeMlFileVersion({
			conversationId: conv._id,
			name: "triage/batch.csv",
			content:
				"id,title,body,score\n" +
				'gh-1,"Crash, on start","Steps:\n1. open\n2. click ""Run""",0.9\n' +
				"gh-2,Dark mode,,\n",
			origin: "write",
		});

		expect(
			await run({ title: "CSV", source: { file: "triage/batch.csv" }, fields: TABLE_FIELDS })
		).toEqual({ awaitingInput: true });

		const review = await collections.mlReviews.findOne({ conversationId: conv._id });
		expect(review?.records).toEqual([
			{
				id: "gh-1",
				values: { title: "Crash, on start", body: 'Steps:\n1. open\n2. click "Run"', score: 0.9 },
			},
			{ id: "gh-2", values: { title: "Dark mode" } },
		]);
	});

	it("reads a tsv from a sandbox path", async () => {
		const { conv, run } = setup();
		vi.mocked(readSandboxPage).mockResolvedValueOnce(
			page('id\ttitle\tscore\nr1\tsays "hi", then leaves\t3\n')
		);

		expect(
			await run({
				title: "TSV",
				source: { sandbox: { handle: HANDLE, path: "/work/sample.tsv" } },
				fields: TABLE_FIELDS,
			})
		).toEqual({ awaitingInput: true });

		const review = await collections.mlReviews.findOne({ conversationId: conv._id });
		expect(review?.records).toEqual([
			{ id: "r1", values: { title: 'says "hi", then leaves', score: 3 } },
		]);
	});

	it("names a cell that does not convert to its declared number", async () => {
		const { run } = setup();
		vi.mocked(readHubPage).mockResolvedValueOnce(page("id,score\nr1,4\nr2,high\n"));
		const outcome = await run({
			title: "Hub CSV",
			source: { hub: "hf://datasets/org/repo/rows.csv" },
			fields: TABLE_FIELDS,
		});
		expect(errorOf(outcome)).toContain("record 2: score must be a number");
	});

	it("refuses a header that does not match the declared fields", async () => {
		const { conv, run } = setup();
		await writeMlFileVersion({
			conversationId: conv._id,
			name: "rows.csv",
			content: "id,title,label\nr1,a,bug\n",
			origin: "write",
		});
		const outcome = await run({ title: "T", source: { file: "rows.csv" }, fields: TABLE_FIELDS });
		expect(errorOf(outcome)).toContain(
			'rows.csv v1 header column "label" matches no declared field (fields: title, body, score); declare it or drop the column'
		);
	});

	it("keeps json parsing for every other extension", async () => {
		const { conv, run } = setup();
		await writeMlFileVersion({
			conversationId: conv._id,
			name: "rows.txt",
			content: "id,title\nr1,a\n",
			origin: "write",
		});
		const outcome = await run({ title: "T", source: { file: "rows.txt" }, fields: TABLE_FIELDS });
		expect(errorOf(outcome)).toContain("rows.txt v1 line 1 is not valid JSON");
	});
});

describe("request_review errors the model can fix", () => {
	it("names the record and the field", async () => {
		const { run } = setup();
		const bad = records(14);
		bad[13] = { ...bad[13], body: 3 as unknown as string };
		const outcome = await run({ title: "T", source: { records: bad }, fields: FIELDS });
		expect(errorOf(outcome)).toContain("record 14: body must be a string");
	});

	it("names the declaration path", async () => {
		const { run } = setup();
		const outcome = await run({
			title: "T",
			source: { records: records(2) },
			fields: FIELDS,
			questions: [{ name: "kind", type: "label", options: [{ value: "only" }] }],
		});
		expect(errorOf(outcome)).toContain("questions[0].options: give 2 to 20 options");
	});

	it("lists the files there are when the source file is missing", async () => {
		const { conv, run } = setup();
		await writeMlFileVersion({
			conversationId: conv._id,
			name: "other.jsonl",
			content: jsonl(1),
			origin: "write",
		});
		const outcome = await run({ title: "T", source: { file: "nope.jsonl" }, fields: FIELDS });
		expect(errorOf(outcome)).toContain(
			'No virtual file "nope.jsonl". Files that exist: other.jsonl (v1).'
		);
	});

	it("refuses a schema file nobody wrote, and a schema beside inline fields", async () => {
		const { run } = setup();
		expect(
			errorOf(await run({ title: "T", source: { records: records(1) }, schema: "s.json" }))
		).toContain(
			'no virtual file "s.json"; write the {fields, questions} JSON with write_file first'
		);
		expect(
			errorOf(
				await run({
					title: "T",
					source: { records: records(1) },
					schema: "s.json",
					fields: FIELDS,
				})
			)
		).toContain("pass schema or inline fields and questions, not both");
	});

	it("measures records as stored, where small json numbers grow several times", async () => {
		const { run } = setup();
		const zeros = JSON.stringify({ id: "a", meta: Array.from({ length: 400_000 }, () => 0) });
		expect(zeros.length).toBeLessThan(1_000_000);
		vi.mocked(readHubPage).mockResolvedValueOnce(page(zeros));

		const outcome = await run({
			title: "Wide",
			source: { hub: "hf://datasets/org/repo/wide.jsonl" },
			fields: [{ name: "meta", type: "json" }],
		});

		expect(errorOf(outcome)).toMatch(
			/the records take \d+\.\d MB once stored; a review holds at most 4 MB/
		);
	});

	it("needs exactly one source", async () => {
		const { run } = setup();
		expect(
			errorOf(await run({ title: "T", source: { records: [], hub: "hf://x/y" }, fields: FIELDS }))
		).toContain("exactly one of records, file, sandbox or hub, got records, hub");
	});
});
