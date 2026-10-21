import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BSON, ObjectId } from "mongodb";
import superjson from "superjson";
import { collections, ready } from "$lib/server/database";
import { ML_FILE_VERSION_INDEX } from "$lib/server/mlFiles/indexes";
import { createReview } from "$lib/server/mlReviews/store";
import { REVIEW_MAX_DRAFT_BYTES } from "$lib/server/mlReviews/api";
import type { MlReview, ReviewSchema } from "$lib/types/MlReview";
import type { Conversation } from "$lib/types/Conversation";
import {
	cleanupTestData,
	createTestConversation,
	createTestLocals,
	createTestUser,
} from "./testHelpers";

const deliverReview = vi.hoisted(() => vi.fn(async () => "sent" as const));
vi.mock("$lib/server/mlReviews/delivery", () => ({
	deliverReview,
	sweepReviewDeliveries: vi.fn(),
}));
vi.mock("@huggingface/hub", async (importOriginal) => ({
	...(await importOriginal<typeof import("@huggingface/hub")>()),
	commit: vi.fn(async () => ({
		commit: { oid: "abc123", url: "https://huggingface.co/datasets/pngwn/gold/commit/abc123" },
		hookOutput: "",
	})),
	fileExists: vi.fn(async () => false),
	datasetInfo: vi.fn(async () => ({ sha: "head1" })),
}));
vi.mock("$lib/server/logger", () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() },
}));

const { GET, PATCH } =
	await import("../../../../routes/api/v2/conversations/[id]/reviews/[reviewId]/+server");
const { submitReviewRequest } = await import("$lib/server/mlReviews/api");
const { ensureReviewResult } = await import("$lib/server/mlReviews/result");
const { finishStoredSubmissions } = await import("$lib/server/mlReviews/submission");
const { submitReview } = await import("$lib/server/mlReviews/store");
const { POST: SUBMIT } =
	await import("../../../../routes/api/v2/conversations/[id]/reviews/[reviewId]/submit/+server");
const { GET: MEDIA } =
	await import("../../../../routes/api/v2/conversations/[id]/reviews/[reviewId]/media/[index]/[field]/+server");
const hub = await import("@huggingface/hub");
const { resumeParkedToolCall } = await import("$lib/server/mcp/resumeElicitation");
const { submitElicitationAnswer } = await import("$lib/server/mcp/elicitation");
const { detachOpenReviews } = await import("$lib/server/mlReviews/detach");

const SCHEMA: ReviewSchema = {
	title: "Triage batch 1",
	idField: "id",
	fields: [{ name: "body", type: "text" }],
	questions: [
		{
			name: "kind",
			type: "label",
			required: true,
			options: [{ value: "bug" }, { value: "feature" }],
		},
	],
	suggestions: "after_answer",
};

async function seed(
	locals: App.Locals,
	records = 2
): Promise<{ conv: Conversation; review: MlReview }> {
	const conv = await createTestConversation(locals, { mlAssistant: true });
	const elicitationId = crypto.randomUUID();
	const review = await createReview({
		conversationId: conv._id,
		messageId: "msg-1",
		toolCallId: "call-1",
		toolUuid: "uuid-1",
		elicitationId,
		schema: SCHEMA,
		schemaHash: "3f2a91c0",
		source: { kind: "inline" },
		records: Array.from({ length: records }, (_, i) => ({
			id: `gh-${i + 1}`,
			values: { body: `Body ${i + 1}` },
			...(i === 0 ? { suggestions: { kind: { value: "bug" } } } : {}),
		})),
	});
	const now = new Date();
	await collections.mcpElicitations.insertOne({
		_id: new ObjectId(),
		elicitationId,
		conversationId: conv._id,
		status: "pending",
		request: {
			elicitationId,
			source: "assistant",
			server: "",
			mode: "form",
			message: SCHEMA.title,
		},
		pending: {
			kind: "review",
			reviewId: review._id.toString(),
			messageId: "msg-1",
			toolCallId: "call-1",
			toolUuid: "uuid-1",
		},
		createdAt: now,
		updatedAt: now,
	});
	return { conv, review };
}

const event = (locals: App.Locals, id: string, reviewId: string, body?: unknown) =>
	({
		locals,
		params: { id, reviewId },
		request: new Request("http://localhost/review", {
			method: body === undefined ? "GET" : "POST",
			...(body === undefined
				? {}
				: { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
		}),
	}) as never;

async function statusOf(promise: Response | Promise<Response>): Promise<number> {
	try {
		return (await promise).status;
	} catch (e: unknown) {
		const status = (e as { status?: unknown }).status;
		if (typeof status !== "number") throw e;
		return status;
	}
}

async function errorOf(
	promise: Response | Promise<Response>
): Promise<{ status: number; message: string }> {
	try {
		const res = await promise;
		return { status: res.status, message: "" };
	} catch (e: unknown) {
		const err = e as { status: number; body?: { message?: string } };
		return { status: err.status, message: err.body?.message ?? "" };
	}
}

const draft = (answers: Record<string, unknown>, comments: unknown[] = []) => ({
	status: "answered",
	answers,
	comments,
});

const comments = (n: number, prefix = "c") =>
	Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, body: `note ${i}` }));

/** drafts as stored, record i holding counts[i] comments */
const storedDrafts = (counts: number[]): MlReview["drafts"] =>
	Object.fromEntries(
		counts.map((n, i) => [
			String(i),
			{
				status: "answered" as const,
				answers: {},
				comments: comments(n, `s${i}-`).map((c) => ({ ...c, createdAt: new Date() })),
				updatedAt: new Date(),
			},
		])
	);

const commentCount = async (reviewId: ObjectId) =>
	Object.values((await collections.mlReviews.findOne({ _id: reviewId }))?.drafts ?? {}).reduce(
		(sum, d) => sum + (d?.comments?.length ?? 0),
		0
	);

beforeAll(async () => {
	await ready;
	await collections.mlFiles.createIndex(ML_FILE_VERSION_INDEX.keys, ML_FILE_VERSION_INDEX.options);
});

afterEach(async () => {
	await cleanupTestData();
	await collections.mcpElicitations.deleteMany({});
});

describe.sequential("reviews endpoint access", () => {
	it("returns the schema, records, drafts and status to the owner", async () => {
		const { locals } = await createTestUser();
		const { conv, review } = await seed(locals);

		const res = await GET(event(locals, conv._id.toString(), review._id.toString()));

		expect(res.status).toBe(200);
		const payload = superjson.parse<Record<string, unknown>>(await res.text());
		expect(payload).toMatchObject({
			id: review._id.toString(),
			schema: SCHEMA,
			schemaHash: "3f2a91c0",
			drafts: {},
			status: "open",
		});
		expect(payload.records).toHaveLength(2);
	});

	it("is 404 to another user, whatever ids they hold", async () => {
		const { locals: owner } = await createTestUser();
		const { locals: other } = await createTestUser();
		const { conv, review } = await seed(owner);
		const otherConv = await createTestConversation(other);

		expect(await statusOf(GET(event(other, conv._id.toString(), review._id.toString())))).toBe(404);
		expect(await statusOf(GET(event(other, otherConv._id.toString(), review._id.toString())))).toBe(
			404
		);
		expect(
			await statusOf(
				SUBMIT(event(other, conv._id.toString(), review._id.toString(), { verdict: "approve" }))
			)
		).toBe(404);
	});

	it("is 404 on a share id, whose reader is not the owner", async () => {
		const { locals } = await createTestUser();
		const { review } = await seed(locals);
		expect(await statusOf(GET(event(locals, "abcdefg", review._id.toString())))).toBe(404);
	});

	it("is 401 without a session and 404 for a malformed review id", async () => {
		const { locals } = await createTestUser();
		const { conv } = await seed(locals);
		const anonymous = createTestLocals({ sessionId: undefined, user: undefined });
		expect(await statusOf(GET(event(anonymous, conv._id.toString(), "x")))).toBe(401);
		expect(await statusOf(GET(event(locals, conv._id.toString(), "not-an-id")))).toBe(404);
	});
});

describe.sequential("saving a draft", () => {
	it("stores an invalid answer and flags it, so a half-done label survives a reload", async () => {
		const { locals } = await createTestUser();
		const { conv, review } = await seed(locals);

		const res = await PATCH(
			event(locals, conv._id.toString(), review._id.toString(), {
				index: 1,
				draft: draft({ kind: "nope" }, [{ id: "c1", field: "body", body: "typo here" }]),
			})
		);

		expect(await res.json()).toEqual({
			ok: true,
			problems: [{ question: "kind", reason: '"nope" is not an option (bug, feature)' }],
			revision: 1,
		});
		const stored = await collections.mlReviews.findOne({ _id: review._id });
		expect(stored?.drafts["1"]).toMatchObject({
			status: "answered",
			answers: { kind: "nope" },
			comments: [{ id: "c1", field: "body", body: "typo here", createdAt: expect.any(Date) }],
		});
	});

	it("holds the comment caps: 20 per record, 2,000 characters each, 200 per review", async () => {
		const { locals } = await createTestUser();
		const { conv, review } = await seed(locals, 12);
		const patch = (index: number, body: ReturnType<typeof draft>) =>
			errorOf(
				PATCH(event(locals, conv._id.toString(), review._id.toString(), { index, draft: body }))
			);

		expect(await patch(0, draft({}, comments(21)))).toMatchObject({
			status: 400,
			message: expect.stringContaining("at most 20 comments on one record"),
		});
		expect(await patch(0, draft({}, [{ id: "long", body: "x".repeat(2_001) }]))).toMatchObject({
			status: 400,
			message: expect.stringContaining("2000 characters"),
		});

		for (let index = 0; index < 10; index += 1) {
			expect((await patch(index, draft({}, comments(20, `r${index}-`)))).status).toBe(200);
		}
		expect(await patch(10, draft({}, comments(1)))).toMatchObject({
			status: 400,
			message: "a review holds at most 200 comments",
		});
		expect((await patch(9, draft({}, comments(20, "again-")))).status).toBe(200);
	});

	it("answers 413 once the drafts would outgrow their share of the row, never a 500", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals, { mlAssistant: true });
		const notes = ["a", "b", "c", "d", "e"].map((n) => `note_${n}`);
		const review = await createReview({
			conversationId: conv._id,
			messageId: "m",
			toolCallId: "c",
			toolUuid: "u",
			elicitationId: crypto.randomUUID(),
			schema: {
				...SCHEMA,
				questions: notes.map((name) => ({
					name,
					type: "text" as const,
					required: false,
					maxLength: 4_000,
				})),
			},
			schemaHash: "abcd1234",
			source: { kind: "inline" },
			records: Array.from({ length: 500 }, (_, i) => ({ id: `r${i}`, values: {} })),
		});
		const full = {
			status: "answered" as const,
			answers: Object.fromEntries(notes.map((name) => [name, "n".repeat(4_000)])),
			comments: [],
			updatedAt: new Date(),
		};
		const fits = Math.floor((REVIEW_MAX_DRAFT_BYTES - 5_000) / BSON.calculateObjectSize(full));
		await collections.mlReviews.updateOne(
			{ _id: review._id },
			{
				$set: {
					drafts: Object.fromEntries(Array.from({ length: fits }, (_, i) => [String(i), full])),
				},
			}
		);
		const patch = (index: number, answers: Record<string, string>) =>
			errorOf(
				PATCH(
					event(locals, conv._id.toString(), review._id.toString(), {
						index,
						draft: draft(answers),
					})
				)
			);

		expect(await patch(fits, full.answers)).toEqual({
			status: 413,
			message:
				"This review's answers have reached the 8 MB limit. Shorten long answers, or submit this batch and review the rest in another.",
		});
		expect(
			Object.keys((await collections.mlReviews.findOne({ _id: review._id }))?.drafts ?? {})
		).toHaveLength(fits);
		expect((await patch(0, { note_a: "shorter" })).status).toBe(200);
		expect((await patch(fits, { note_a: "short" })).status).toBe(200);
	});

	it("refuses a save from a tab that missed another tab's save of the same record", async () => {
		const { locals } = await createTestUser();
		const { conv, review } = await seed(locals);
		const save = (
			baseRevision: number,
			answers: Record<string, string>,
			comments: unknown[] = []
		) =>
			PATCH(
				event(locals, conv._id.toString(), review._id.toString(), {
					index: 0,
					baseRevision,
					draft: draft(answers, comments),
				})
			);

		const first = await save(0, { kind: "bug" });
		expect(await first.json()).toEqual({ ok: true, problems: [], revision: 1 });
		const stale = await save(0, {}, [{ id: "c1", body: "dupe of #4" }]);

		expect(stale.status).toBe(409);
		const body = superjson.parse<{ message: string; draft: Record<string, unknown> }>(
			await stale.text()
		);
		expect(body.message).toBe("This record was changed elsewhere, its current draft is attached.");
		expect(body.draft).toMatchObject({ answers: { kind: "bug" }, revision: 1 });
		expect((await collections.mlReviews.findOne({ _id: review._id }))?.drafts["0"]).toMatchObject({
			answers: { kind: "bug" },
			comments: [],
		});
		expect(
			await (await save(1, { kind: "bug" }, [{ id: "c1", body: "dupe of #4" }])).json()
		).toEqual({
			ok: true,
			problems: [],
			revision: 2,
		});
	});

	it("stores box and time anchors only on the media they fit, boxes rounded", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals, { mlAssistant: true });
		const review = await createReview({
			conversationId: conv._id,
			messageId: "m",
			toolCallId: "c",
			toolUuid: "u",
			elicitationId: crypto.randomUUID(),
			schema: {
				...SCHEMA,
				fields: [
					{ name: "body", type: "text" },
					{ name: "photo", type: "image" },
					{ name: "voice", type: "audio" },
					{ name: "clip", type: "video" },
				],
				questions: [],
			},
			schemaHash: "abcd1234",
			source: { kind: "inline" },
			records: [{ id: "r1", values: {} }],
		});
		const save = (comment: Record<string, unknown>) =>
			errorOf(
				PATCH(
					event(locals, conv._id.toString(), review._id.toString(), {
						index: 0,
						draft: draft({}, [{ id: "c", body: "note", ...comment }]),
					})
				)
			);

		expect(
			(await save({ field: "photo", area: { x: 0.123456, y: 0.2, w: 0.3, h: 0.4 } })).status
		).toBe(200);
		expect(
			(await collections.mlReviews.findOne({ _id: review._id }))?.drafts["0"].comments[0].area
		).toEqual({ x: 0.1235, y: 0.2, w: 0.3, h: 0.4 });
		expect((await save({ field: "voice", time: { start: 12, end: 18 } })).status).toBe(200);
		expect(
			(await save({ field: "clip", time: { start: 3 }, area: { x: 0, y: 0, w: 1, h: 1 } })).status
		).toBe(200);
		expect(
			(await save({ field: "body", quote: { exact: "x", prefix: "", suffix: "" } })).status
		).toBe(200);

		expect(await save({ field: "clip", area: { x: 0, y: 0, w: 0.5, h: 0.5 } })).toEqual({
			status: 400,
			message: "draft.comments.0.time: a box on a video needs the frame time in time.start",
		});
		expect(await save({ field: "photo", time: { start: 1 } })).toEqual({
			status: 400,
			message: "draft.comments.0.time: a time is only on an audio or video field",
		});
		expect(await save({ field: "voice", area: { x: 0, y: 0, w: 0.5, h: 0.5 } })).toEqual({
			status: 400,
			message: "draft.comments.0.area: an area is only on an image or video field",
		});
		expect(await save({ field: "photo", quote: { exact: "x", prefix: "", suffix: "" } })).toEqual({
			status: 400,
			message: "draft.comments.0.quote: a quote is only on a text, markdown or code field",
		});
		expect(await save({ field: "photo", area: { x: 0.8, y: 0, w: 0.3, h: 0.5 } })).toEqual({
			status: 400,
			message: "draft.comments.0.area.w: x + w must not exceed 1",
		});
		expect(await save({ field: "voice", time: { start: 18, end: 12 } })).toEqual({
			status: 400,
			message: "draft.comments.0.time.end: end must be after start",
		});
		expect((await save({ field: "voice", time: { start: 90_000 } })).status).toBe(400);
	});

	it("refuses keys that would become Mongo keys without being declared", async () => {
		const { locals } = await createTestUser();
		const { conv, review } = await seed(locals);
		const patched = await errorOf(
			PATCH(
				event(locals, conv._id.toString(), review._id.toString(), {
					index: 0,
					draft: draft({ "$where.x": "bug" }),
				})
			)
		);
		expect(patched).toMatchObject({ status: 400, message: "answers.$where.x: no such question" });
		expect(
			await errorOf(
				PATCH(
					event(locals, conv._id.toString(), review._id.toString(), {
						index: 2,
						draft: draft({ kind: "bug" }),
					})
				)
			)
		).toMatchObject({ status: 400, message: "index: the review has 2 records" });
	});

	it("parallel saves that each add a comment never take the review past 200", async () => {
		const { locals } = await createTestUser();
		const { conv, review } = await seed(locals, 30);
		await collections.mlReviews.updateOne(
			{ _id: review._id },
			{ $set: { drafts: storedDrafts([19, 19, 19, 19, 19, 19, 19, 19, 19, 19]) } }
		);

		const statuses = await Promise.all(
			Array.from({ length: 20 }, (_, i) =>
				statusOf(
					PATCH(
						event(locals, conv._id.toString(), review._id.toString(), {
							index: 10 + i,
							draft: draft({}, comments(1, `p${i}-`)),
						})
					)
				)
			)
		);

		const total = await commentCount(review._id);
		expect(total).toBeLessThanOrEqual(200);
		expect(total).toBe(190 + statuses.filter((s) => s === 200).length);
		expect(statuses).toContain(200);
		expect(statuses.every((s) => [200, 400, 409].includes(s))).toBe(true);
	});
});

describe.sequential("bulk draft writes", () => {
	const bulk = (locals: App.Locals, conv: Conversation, review: MlReview, body: unknown) =>
		PATCH(event(locals, conv._id.toString(), review._id.toString(), { bulk: body }));

	it("applies one change to every listed record in one write and returns their revisions", async () => {
		const { locals } = await createTestUser();
		const { conv, review } = await seed(locals, 4);
		await PATCH(
			event(locals, conv._id.toString(), review._id.toString(), {
				index: 1,
				draft: {
					status: "pending",
					answers: { kind: "bug" },
					comments: [{ id: "old", body: "seen" }],
				},
			})
		);
		const before = await collections.mlReviews.findOne({ _id: review._id });

		const res = await bulk(locals, conv, review, {
			indexes: [0, 1, 2],
			status: "discarded",
			addComment: { id: "dup", field: "body", body: "duplicate" },
		});

		expect(await res.json()).toEqual({ ok: true, revisions: { "0": 1, "1": 2, "2": 1 } });
		const stored = await collections.mlReviews.findOne({ _id: review._id });
		expect(stored?.draftRevision).toBe((before?.draftRevision ?? 0) + 1);
		expect(stored?.drafts["1"]).toMatchObject({
			status: "discarded",
			answers: { kind: "bug" },
			comments: [
				{ id: "old", body: "seen" },
				{ id: "dup-1", field: "body", body: "duplicate" },
			],
			revision: 2,
		});
		expect(stored?.drafts["0"]?.comments).toEqual([
			expect.objectContaining({ id: "dup-0", field: "body", body: "duplicate" }),
		]);
		expect(stored?.drafts["3"]).toBeUndefined();
	});

	it("merges answers, deletes on null and recomputes the status when none is given", async () => {
		const { locals } = await createTestUser();
		const { conv, review } = await seed(locals, 3);

		const set = await bulk(locals, conv, review, { indexes: [0, 1], answers: { kind: "feature" } });
		expect(await set.json()).toEqual({ ok: true, revisions: { "0": 1, "1": 1 } });
		let stored = await collections.mlReviews.findOne({ _id: review._id });
		expect(stored?.drafts["0"]).toMatchObject({ status: "answered", answers: { kind: "feature" } });

		const cleared = await bulk(locals, conv, review, { indexes: [1], answers: { kind: null } });
		expect(await cleared.json()).toEqual({ ok: true, revisions: { "1": 2 } });
		stored = await collections.mlReviews.findOne({ _id: review._id });
		expect(stored?.drafts["1"]).toMatchObject({ status: "pending", answers: {} });
		expect(stored?.drafts["0"]).toMatchObject({ answers: { kind: "feature" }, revision: 1 });
	});

	it("validates like a single save and writes nothing when any part fails", async () => {
		const { locals } = await createTestUser();
		const { conv, review } = await seed(locals, 3);
		const refused = (body: unknown) => errorOf(bulk(locals, conv, review, body));

		expect(await refused({ indexes: [0, 3], status: "answered" })).toEqual({
			status: 400,
			message: "bulk.indexes: the review has 3 records, 3 is past them",
		});
		expect(await refused({ indexes: [0, 0], status: "answered" })).toEqual({
			status: 400,
			message: "bulk.indexes: repeats an index",
		});
		expect(
			(await refused({ indexes: Array.from({ length: 501 }, (_, i) => i), status: "answered" }))
				.status
		).toBe(400);
		expect((await refused({ indexes: [0] })).status).toBe(400);
		expect(await refused({ indexes: [0], answers: { $where: "x" } })).toEqual({
			status: 400,
			message: "bulk.answers.$where: no such question",
		});
		expect(await refused({ indexes: [0], answers: { kind: "nope" } })).toEqual({
			status: 400,
			message: 'bulk.answers.kind: "nope" is not an option (bug, feature)',
		});
		expect(
			await refused({ indexes: [0], addComment: { id: "q", field: "nope", body: "x" } })
		).toEqual({ status: 400, message: 'comments: no field "nope"' });
		expect((await collections.mlReviews.findOne({ _id: review._id }))?.drafts).toEqual({});
	});

	it("holds the comment caps, naming how many the review has left", async () => {
		const { locals } = await createTestUser();
		const { conv, review } = await seed(locals, 30);
		await collections.mlReviews.updateOne(
			{ _id: review._id },
			{ $set: { drafts: storedDrafts([20, 20, 20, 20, 20, 20, 20, 20, 20, 8]) } }
		);
		const add = (indexes: number[]) =>
			errorOf(bulk(locals, conv, review, { indexes, addComment: { id: "c", body: "same" } }));

		expect(await add(Array.from({ length: 13 }, (_, i) => 10 + i))).toEqual({
			status: 400,
			message: "a review holds at most 200 comments, 12 left",
		});
		expect(await add([0, 10])).toEqual({
			status: 400,
			message: "record 0 already has 20 comments, the most one record holds",
		});
		expect((await add(Array.from({ length: 12 }, (_, i) => 10 + i))).status).toBe(200);
		expect(await add([22])).toEqual({
			status: 400,
			message: "a review holds at most 200 comments, 0 left",
		});
	});

	it("lets one of two racing bulk comments through when each would fit alone", async () => {
		const { locals } = await createTestUser();
		const { conv, review } = await seed(locals, 130);
		await collections.mlReviews.updateOne(
			{ _id: review._id },
			{ $set: { drafts: storedDrafts([20, 20, 20, 20, 20]) } }
		);
		const add = (from: number) =>
			errorOf(
				bulk(locals, conv, review, {
					indexes: Array.from({ length: 60 }, (_, i) => from + i),
					addComment: { id: `c${from}`, body: "same" },
				})
			);

		const results = await Promise.all([add(10), add(70)]);

		expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
		expect(results.find((r) => r.status === 400)?.message).toBe(
			"a review holds at most 200 comments, 40 left"
		);
		expect(await commentCount(review._id)).toBe(160);
	});

	it("is 409 once the review is submitted", async () => {
		const { locals } = await createTestUser();
		const { conv, review } = await seed(locals, 2);
		await collections.mlReviews.updateOne({ _id: review._id }, { $set: { status: "submitted" } });
		expect(await statusOf(bulk(locals, conv, review, { indexes: [0], status: "answered" }))).toBe(
			409
		);
	});
});

describe.sequential("submitting", () => {
	const labelBoth = async (locals: App.Locals, conv: Conversation, review: MlReview) => {
		for (const [index, kind] of ["bug", "feature"].entries()) {
			await PATCH(
				event(locals, conv._id.toString(), review._id.toString(), {
					index,
					draft: draft({ kind }),
				})
			);
		}
	};

	it("refuses a submit built from drafts that changed after it read them", async () => {
		const { locals } = await createTestUser();
		const { conv, review } = await seed(locals);
		await labelBoth(locals, conv, review);
		const read = await collections.mlReviews.findOne({ _id: review._id });
		if (!read) throw new Error("review vanished");
		await PATCH(
			event(locals, conv._id.toString(), review._id.toString(), {
				index: 1,
				draft: draft({ kind: "bug" }),
			})
		);

		await expect(submitReviewRequest(read, { verdict: "approve" })).rejects.toMatchObject({
			status: 409,
			body: {
				message: "This review changed while it was being submitted, reload it and submit again.",
			},
		});
		const stored = await collections.mlReviews.findOne({ _id: review._id });
		expect(stored).toMatchObject({ status: "open", drafts: { "1": { answers: { kind: "bug" } } } });
		expect(await collections.mlFiles.countDocuments({ conversationId: conv._id })).toBe(0);
	});

	it("lets a retry finish a submit whose process died before answering the row", async () => {
		const { locals } = await createTestUser();
		const { conv, review } = await seed(locals);
		await labelBoth(locals, conv, review);
		const read = await collections.mlReviews.findOne({ _id: review._id });
		if (!read) throw new Error("review vanished");
		expect(await submitReview(read, {})).toBe(true);

		const res = await SUBMIT(
			event(locals, conv._id.toString(), review._id.toString(), { verdict: "approve" })
		);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			ok: true,
			files: [{ name: "reviews/triage-batch-1.responses.jsonl", version: 1 }],
		});
		expect(
			await collections.mcpElicitations.findOne({ elicitationId: review.elicitationId })
		).toMatchObject({ status: "resolved", action: "accept", resolution: "user" });
		expect(
			await errorOf(
				SUBMIT(event(locals, conv._id.toString(), review._id.toString(), { verdict: "approve" }))
			)
		).toEqual({ status: 409, message: "This review was already submitted." });
	});

	it("treats a retry whose row is already answered as done, not as a message to post", async () => {
		const { locals } = await createTestUser();
		const { conv, review } = await seed(locals);
		await labelBoth(locals, conv, review);
		const read = await collections.mlReviews.findOne({ _id: review._id });
		if (!read) throw new Error("review vanished");
		expect(await submitReview(read, {})).toBe(true);
		await collections.mcpElicitations.updateOne(
			{ elicitationId: review.elicitationId },
			{ $set: { status: "resolved", action: "accept", resolution: "user", resolvedAt: new Date() } }
		);
		deliverReview.mockClear();

		const res = await SUBMIT(
			event(locals, conv._id.toString(), review._id.toString(), { verdict: "approve" })
		);

		expect(await res.json()).toEqual({
			ok: true,
			files: [{ name: "reviews/triage-batch-1.responses.jsonl", version: 1 }],
		});
		expect(deliverReview).not.toHaveBeenCalled();
		const stored = await collections.mlReviews.findOne({ _id: review._id });
		expect(stored?.delivery).toBeUndefined();
		expect(stored?.unresolved).toBeUndefined();
	});

	it("rebuilds a lost result from the files its first attempt wrote", async () => {
		const { locals } = await createTestUser();
		const { conv, review } = await seed(locals);
		await labelBoth(locals, conv, review);
		const read = await collections.mlReviews.findOne({ _id: review._id });
		if (!read) throw new Error("review vanished");
		expect(await submitReview(read, {})).toBe(true);
		const claimed = await collections.mlReviews.findOne({ _id: review._id });
		if (!claimed) throw new Error("review vanished");
		const first = await ensureReviewResult(claimed);
		await collections.mlReviews.updateOne({ _id: review._id }, { $unset: { result: "" } });

		const again = await ensureReviewResult({ ...claimed, result: undefined });

		expect(again.files).toEqual(first.files);
		expect(await collections.mlFiles.countDocuments({ conversationId: conv._id })).toBe(1);
	});

	it("recovers a claimed submission behind more than fifty open reviews", async () => {
		const { locals } = await createTestUser();
		for (let i = 0; i < 55; i += 1) await seed(locals);
		const { conv, review } = await seed(locals);
		await labelBoth(locals, conv, review);
		const read = await collections.mlReviews.findOne({ _id: review._id });
		if (!read) throw new Error("review vanished");
		expect(await submitReview(read, {})).toBe(true);

		await finishStoredSubmissions();

		expect(
			await collections.mcpElicitations.findOne({ elicitationId: review.elicitationId })
		).toMatchObject({ status: "resolved", resolution: "user" });
		const stored = await collections.mlReviews.findOne({ _id: review._id });
		expect(stored?.unresolved).toBeUndefined();
		expect(stored?.result?.files).toHaveLength(1);
		expect(
			await collections.mcpElicitations.countDocuments({
				status: "pending",
				"pending.kind": "review",
			})
		).toBe(55);
	});

	it("accepts a submit with nothing marked, and ignores an old verdict body", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals, { mlAssistant: true });
		const review = await createReview({
			conversationId: conv._id,
			messageId: "m",
			toolCallId: "c",
			toolUuid: "u",
			elicitationId: crypto.randomUUID(),
			schema: { ...SCHEMA, questions: [] },
			schemaHash: "abcd1234",
			source: { kind: "inline" },
			records: [
				{ id: "a", values: {} },
				{ id: "b", values: {} },
			],
		});
		await collections.mlReviews.updateOne({ _id: review._id }, { $set: { status: "detached" } });

		const res = await SUBMIT(
			event(locals, conv._id.toString(), review._id.toString(), {
				verdict: "request_changes",
				summary: "an older pane sent this",
			})
		);

		expect(res.status).toBe(200);
		const stored = await collections.mlReviews.findOne({ _id: review._id });
		expect(stored?.status).toBe("submitted");
		expect(stored).not.toHaveProperty("verdict");
		expect(stored).not.toHaveProperty("note");
		expect(stored?.result?.text).not.toMatch(/verdict|request changes|an older pane/i);
		expect(stored?.result?.text).toContain(
			"Records: 0 marked OK, 0 rejected, 0 skipped, 2 not finished (of 2).\nThe user looked at the records and left no annotations.\n"
		);
		expect(stored?.result?.text?.split("\n").at(-1)).toBe(
			"Next: summarise for the user what these annotations mean, propose next steps, and ask before anything that costs compute or publishes."
		);
	});

	it("passes the user's note on, and a note alone counts as an annotation", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals, { mlAssistant: true });
		const review = await createReview({
			conversationId: conv._id,
			messageId: "m",
			toolCallId: "c",
			toolUuid: "u",
			elicitationId: crypto.randomUUID(),
			schema: { ...SCHEMA, questions: [] },
			schemaHash: "abcd1234",
			source: { kind: "inline" },
			records: [{ id: "a", values: {} }],
		});
		await collections.mlReviews.updateOne({ _id: review._id }, { $set: { status: "detached" } });

		await SUBMIT(
			event(locals, conv._id.toString(), review._id.toString(), {
				note: "  Looks like the scraper truncates long bodies.  ",
			})
		);

		const text = (await collections.mlReviews.findOne({ _id: review._id }))?.result?.text ?? "";
		expect(text).toContain('Note from the user: "Looks like the scraper truncates long bodies."');
		expect(text).not.toContain("left no annotations");
		expect(
			await errorOf(
				SUBMIT(
					event(locals, conv._id.toString(), review._id.toString(), { note: "x".repeat(4_001) })
				)
			)
		).toMatchObject({ status: 400 });
	});

	it("loads a review stored with a verdict, showing its summary as the note", async () => {
		const { locals } = await createTestUser();
		const { conv, review } = await seed(locals);
		await collections.mlReviews.updateOne(
			{ _id: review._id },
			{ $set: { verdict: "request_changes", summary: "older note" } }
		);

		const payload = superjson.parse<Record<string, unknown>>(
			await (await GET(event(locals, conv._id.toString(), review._id.toString()))).text()
		);

		expect(payload.note).toBe("older note");
		expect(payload).not.toHaveProperty("verdict");
		expect(payload).not.toHaveProperty("summary");
	});

	it("words a review with no questions as marked ok and rejected, listing the ids", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals, { mlAssistant: true });
		const review = await createReview({
			conversationId: conv._id,
			messageId: "m",
			toolCallId: "c",
			toolUuid: "u",
			elicitationId: crypto.randomUUID(),
			schema: { ...SCHEMA, questions: [] },
			schemaHash: "abcd1234",
			source: { kind: "inline" },
			records: ["a", "b", "c", "d"].map((id) => ({ id, values: {} })),
		});
		await collections.mlReviews.updateOne({ _id: review._id }, { $set: { status: "detached" } });
		for (const [index, status] of ["answered", "discarded", "answered", "skipped"].entries()) {
			await PATCH(
				event(locals, conv._id.toString(), review._id.toString(), {
					index,
					draft: { status, answers: {}, comments: [] },
				})
			);
		}

		await SUBMIT(event(locals, conv._id.toString(), review._id.toString(), { verdict: "approve" }));

		const text = (await collections.mlReviews.findOne({ _id: review._id }))?.result?.text ?? "";
		expect(text).toContain("Records: 2 marked OK, 1 rejected, 1 skipped, 0 not finished (of 4).");
		expect(text).toContain("Marked OK: a, c\nRejected: b\n");
		expect(text).not.toContain("left no annotations");
		expect(text).not.toContain("Answers:");
		const file = await collections.mlFiles.findOne({ conversationId: conv._id });
		expect(
			file?.content
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line).status)
		).toEqual(["answered", "discarded", "answered", "skipped"]);
	});

	describe("approveRest", () => {
		const reviewWith = async (locals: App.Locals, questions: ReviewSchema["questions"]) => {
			const conv = await createTestConversation(locals, { mlAssistant: true });
			const review = await createReview({
				conversationId: conv._id,
				messageId: "m",
				toolCallId: "c",
				toolUuid: "u",
				elicitationId: crypto.randomUUID(),
				schema: { ...SCHEMA, questions },
				schemaHash: "abcd1234",
				source: { kind: "inline" },
				records: ["a", "b", "c", "d"].map((id) => ({ id, values: {} })),
			});
			await collections.mlReviews.updateOne({ _id: review._id }, { $set: { status: "detached" } });
			const patch = (index: number, status: string, answers: Record<string, unknown> = {}) =>
				PATCH(
					event(locals, conv._id.toString(), review._id.toString(), {
						index,
						draft: { status, answers, comments: [] },
					})
				);
			const submit = (body: Record<string, unknown>) =>
				errorOf(SUBMIT(event(locals, conv._id.toString(), review._id.toString(), body)));
			const stored = async () => {
				const row = await collections.mlReviews.findOne({ _id: review._id });
				if (!row) throw new Error("review vanished");
				return row;
			};
			return { conv, review, patch, submit, stored };
		};

		it("approves every undecided record in the claim, leaving decided ones alone", async () => {
			const { locals } = await createTestUser();
			const { patch, submit, stored } = await reviewWith(locals, []);
			await patch(1, "skipped");
			await patch(2, "discarded");

			expect((await submit({ verdict: "approve", approveRest: true })).status).toBe(200);

			const review = await stored();
			expect([0, 1, 2, 3].map((i) => review.drafts[String(i)]?.status)).toEqual([
				"answered",
				"skipped",
				"discarded",
				"answered",
			]);
			expect(review.status).toBe("submitted");
			expect(review.result?.text).toContain("Marked OK: a, d\nRejected: c\n");
		});

		it("sets the first yes or no question and keeps answers already given", async () => {
			const { locals } = await createTestUser();
			const { patch, submit, stored } = await reviewWith(locals, [
				{ name: "ok", type: "boolean", required: true },
				{ name: "also", type: "boolean", required: false },
				{ name: "note", type: "text", required: false, maxLength: 100 },
			]);
			await patch(0, "pending", { note: "half done" });
			await patch(1, "answered", { ok: false });
			await patch(2, "pending", { ok: false });

			expect((await submit({ verdict: "approve", approveRest: true })).status).toBe(200);

			const drafts = (await stored()).drafts;
			expect(drafts["0"]).toMatchObject({
				status: "answered",
				answers: { note: "half done", ok: true },
			});
			expect(drafts["1"]).toMatchObject({ status: "answered", answers: { ok: false } });
			expect(drafts["3"]).toMatchObject({ status: "answered", answers: { ok: true } });
			expect(drafts["2"]).toMatchObject({ status: "pending", answers: { ok: false } });
			expect(drafts["3"].answers.also).toBeUndefined();
		});

		it("cannot answer a required label for the user, so those records go as not finished", async () => {
			const { locals } = await createTestUser();
			const { submit, stored } = await reviewWith(locals, SCHEMA.questions);

			expect((await submit({ approveRest: true })).status).toBe(200);

			const row = await stored();
			expect(row.status).toBe("submitted");
			expect(row.result?.text).toContain(
				"0 answered, 0 skipped, 0 discarded, 4 not finished (of 4)."
			);
			expect(row.result?.text).toContain("4 of 4 records not finished: a, b, c, d");
		});

		it("lets approve all pass the empty-submit guard, and writes nothing when the claim loses", async () => {
			const { locals } = await createTestUser();
			const { review, submit, stored } = await reviewWith(locals, []);
			const read = await stored();
			await collections.mlReviews.updateOne({ _id: review._id }, { $inc: { draftRevision: 1 } });

			await expect(
				submitReviewRequest(read, { verdict: "approve", approveRest: true })
			).rejects.toMatchObject({ status: 409 });
			expect((await stored()).drafts).toEqual({});

			expect((await submit({ verdict: "approve", approveRest: true })).status).toBe(200);
		});
	});

	it("keeps recovering the others when one stored submission keeps throwing", async () => {
		const { locals } = await createTestUser();
		const healthy = await seed(locals);
		const broken = await seed(locals);
		for (const { conv, review } of [healthy, broken]) {
			await labelBoth(locals, conv, review);
			const read = await collections.mlReviews.findOne({ _id: review._id });
			if (!read) throw new Error("review vanished");
			expect(await submitReview(read, {})).toBe(true);
		}
		// any throw inside the result build stands in for a document that cannot take the write
		await collections.mlReviews.updateOne({ _id: broken.review._id }, {
			$set: { records: null },
		} as never);
		const { settleAnsweredAsks } = await import("$lib/server/generation/askResume");

		await expect(settleAnsweredAsks({ _id: broken.conv._id, messages: [] })).resolves.toBeTypeOf(
			"function"
		);
		await finishStoredSubmissions();

		expect(
			await collections.mcpElicitations.findOne({ elicitationId: healthy.review.elicitationId })
		).toMatchObject({ status: "resolved", resolution: "user" });
		const failing = await collections.mlReviews.findOne({ _id: broken.review._id });
		expect(failing?.unresolved).toBe(true);
		expect(failing?.submitFailure).toMatchObject({ attempts: 1 });
		expect(failing?.submitFailure?.retryAt?.getTime()).toBeGreaterThan(Date.now());

		await finishStoredSubmissions();
		expect(
			(await collections.mlReviews.findOne({ _id: broken.review._id }))?.submitFailure
		).toMatchObject({
			attempts: 1,
		});

		for (let i = 0; i < 5; i += 1) {
			await collections.mlReviews.updateOne(
				{ _id: broken.review._id },
				{ $set: { "submitFailure.retryAt": new Date(Date.now() - 1_000) } }
			);
			await finishStoredSubmissions();
		}
		expect(
			(await collections.mlReviews.findOne({ _id: broken.review._id }))?.submitFailure
		).toMatchObject({
			attempts: 6,
			gaveUp: true,
		});
		await finishStoredSubmissions();
		expect(
			(await collections.mlReviews.findOne({ _id: broken.review._id }))?.submitFailure?.attempts
		).toBe(6);
		const payload = superjson.parse<Record<string, unknown>>(
			await (
				await GET(event(locals, broken.conv._id.toString(), broken.review._id.toString()))
			).text()
		);
		expect(typeof payload.submitFailed).toBe("string");
	});

	it("submits with a required question open, naming the unfinished records", async () => {
		const { locals } = await createTestUser();
		const { conv, review } = await seed(locals, 3);
		await PATCH(
			event(locals, conv._id.toString(), review._id.toString(), {
				index: 0,
				draft: draft({ kind: "bug" }),
			})
		);
		await PATCH(
			event(locals, conv._id.toString(), review._id.toString(), {
				index: 1,
				draft: draft({}, [{ id: "c", body: "unsure" }]),
			})
		);

		const res = await SUBMIT(event(locals, conv._id.toString(), review._id.toString(), {}));

		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ ok: true, files: [expect.any(Object)] });
		const stored = await collections.mlReviews.findOne({ _id: review._id });
		expect(stored?.status).toBe("submitted");
		expect(stored?.result?.text).toContain(
			"Records: 1 answered, 0 skipped, 0 discarded, 2 not finished (of 3)."
		);
		expect(stored?.result?.text).toContain("2 of 3 records not finished: gh-2, gh-3");
		expect(stored?.result?.text).toContain("Those records are missing labels.");
		const file = await collections.mlFiles.findOne({
			conversationId: conv._id,
			name: "reviews/triage-batch-1.responses.jsonl",
		});
		expect(
			file?.content
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line).status)
		).toEqual(["answered", "pending", "pending"]);
	});

	it("still refuses an answer that is there but not valid", async () => {
		const { locals } = await createTestUser();
		const { conv, review } = await seed(locals);
		await PATCH(
			event(locals, conv._id.toString(), review._id.toString(), {
				index: 0,
				draft: draft({ kind: "nope" }),
			})
		);

		const res = await SUBMIT(event(locals, conv._id.toString(), review._id.toString(), {}));

		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({
			message: "Some answers are not valid.",
			blockers: [{ record: 0, question: "kind", reason: '"nope" is not an option (bug, feature)' }],
		});
		expect((await collections.mlReviews.findOne({ _id: review._id }))?.status).toBe("open");
	});

	it("posts a detached review through the server delivery, resolving nothing", async () => {
		const { locals } = await createTestUser();
		const { conv, review } = await seed(locals);
		await collections.mcpElicitations.updateOne(
			{ elicitationId: review.elicitationId },
			{ $set: { status: "resolved", action: "cancel", resolution: "withdrawn" } }
		);
		await collections.mlReviews.updateOne({ _id: review._id }, { $set: { status: "detached" } });
		for (const [index, kind] of ["bug", "feature"].entries()) {
			await PATCH(
				event(locals, conv._id.toString(), review._id.toString(), {
					index,
					draft: draft({ kind }, index === 0 ? [{ id: "c", body: "dupe of #4" }] : []),
				})
			);
		}

		const res = await SUBMIT(
			event(locals, conv._id.toString(), review._id.toString(), {
				note: "Mostly fine.",
			})
		);

		expect(res.status).toBe(200);
		const outcome = await res.json();
		expect(outcome).toMatchObject({ ok: true, delivery: "sent" });
		expect(deliverReview).toHaveBeenCalledWith(review._id, {});
		const body = {
			text: (await collections.mlReviews.findOne({ _id: review._id }))?.result?.text ?? "",
		};
		expect(body.text).toContain('Review "Triage batch 1" submitted (schema 3f2a91c0).');
		expect(body.text).toContain('Note from the user: "Mostly fine."');
		expect(body.text).toContain(
			"Records: 2 answered, 0 skipped, 0 discarded, 0 not finished (of 2)."
		);
		expect(body.text).toContain("kind: bug 1, feature 1. Your suggestion matched on 1 of 1.");
		expect(body.text).toContain("- gh-1 record: dupe of #4");
		expect(body.text).toContain("- gh-2 (answered): kind=feature");
		expect(body.text).toContain(
			"All answers: v-file://reviews/triage-batch-1.responses.jsonl (version 1)"
		);
		const stored = await collections.mlReviews.findOne({ _id: review._id });
		expect(stored).toMatchObject({
			status: "submitted",
			note: "Mostly fine.",
		});
		expect(
			await collections.mcpElicitations.findOne({ elicitationId: review.elicitationId })
		).toMatchObject({ resolution: "withdrawn" });

		const file = await collections.mlFiles.findOne({
			conversationId: conv._id,
			name: "reviews/triage-batch-1.responses.jsonl",
		});
		expect(file?.origin).toBe("review");
		expect(
			file?.content
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line))
		).toEqual([
			{
				id: "gh-1",
				status: "answered",
				answers: { kind: "bug" },
				suggested: { kind: "bug" },
				comments: [{ body: "dupe of #4" }],
				schema: "3f2a91c0",
			},
			{
				id: "gh-2",
				status: "answered",
				answers: { kind: "feature" },
				suggested: {},
				comments: [],
				schema: "3f2a91c0",
			},
		]);
	});

	it("is 409 once the review expired, and once it was submitted", async () => {
		const { locals } = await createTestUser();
		const { conv, review } = await seed(locals);
		await collections.mlReviews.updateOne({ _id: review._id }, { $set: { status: "expired" } });
		expect(
			await errorOf(
				SUBMIT(event(locals, conv._id.toString(), review._id.toString(), { verdict: "approve" }))
			)
		).toEqual({ status: 409, message: "This review expired." });
		expect(
			await errorOf(
				PATCH(
					event(locals, conv._id.toString(), review._id.toString(), {
						index: 0,
						draft: draft({ kind: "bug" }),
					})
				)
			)
		).toEqual({ status: 409, message: "This review expired." });

		await collections.mlReviews.updateOne({ _id: review._id }, { $set: { status: "submitted" } });
		expect(
			await errorOf(
				SUBMIT(event(locals, conv._id.toString(), review._id.toString(), { verdict: "approve" }))
			)
		).toEqual({ status: 409, message: "This review was already submitted." });
	});

	it("splits a responses file over 256 KiB into parts", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals, { mlAssistant: true });
		const review = await createReview({
			conversationId: conv._id,
			messageId: "m",
			toolCallId: "c",
			toolUuid: "u",
			elicitationId: crypto.randomUUID(),
			schema: {
				...SCHEMA,
				questions: [{ name: "note", type: "text", required: false, maxLength: 4_000 }],
			},
			schemaHash: "abcd1234",
			source: { kind: "inline" },
			records: Array.from({ length: 100 }, (_, i) => ({ id: `r${i}`, values: {} })),
		});
		await collections.mlReviews.updateOne(
			{ _id: review._id },
			{
				$set: {
					status: "detached",
					drafts: Object.fromEntries(
						Array.from({ length: 100 }, (_, i) => [
							String(i),
							{
								status: "answered",
								answers: { note: "n".repeat(4_000) },
								comments: [],
								updatedAt: new Date(),
							},
						])
					),
				},
			}
		);

		await SUBMIT(event(locals, conv._id.toString(), review._id.toString(), { verdict: "approve" }));
		const body = {
			text: (await collections.mlReviews.findOne({ _id: review._id }))?.result?.text ?? "",
		};

		const files = await collections.mlFiles.find({ conversationId: conv._id }).toArray();
		expect(files.map((f) => f.name).sort()).toEqual([
			"reviews/triage-batch-1.responses.part-1.jsonl",
			"reviews/triage-batch-1.responses.part-2.jsonl",
		]);
		expect(files.every((f) => f.size <= 256 * 1024)).toBe(true);
		expect(files.flatMap((f) => f.content.trim().split("\n"))).toHaveLength(100);
		expect(body.text).toContain("All answers, in 2 parts:");
		expect(body.text).not.toContain("Answers:");
	});
});

describe.sequential("writing labels back", () => {
	const AUDIENCE = {
		label: "existing public dataset pngwn/gold",
		exists: true,
		private: false,
		canWrite: true,
	};
	let owner = "pngwn";
	beforeEach(() => {
		owner = "pngwn";
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: string | URL) => {
				const url = String(input);
				if (url.endsWith("/api/datasets/pngwn/gold")) return Response.json({ private: false });
				if (url.endsWith("/api/whoami-v2")) {
					return Response.json({ name: owner, orgs: [], auth: { accessToken: { role: "write" } } });
				}
				return new Response("not stubbed", { status: 500 });
			})
		);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});
	const DESTINATION = {
		repo: "pngwn/gold",
		type: "dataset" as const,
		path: "data/a.parquet",
		pr: false,
	};
	const answerBoth = async (locals: App.Locals, conv: Conversation, review: MlReview) => {
		for (const index of [0, 1]) {
			await PATCH(
				event(locals, conv._id.toString(), review._id.toString(), {
					index,
					draft: draft({ kind: "bug" }),
				})
			);
		}
	};
	const withDestination = async (locals: App.Locals, status?: "detached") => {
		const { conv, review } = await seed(locals);
		await collections.mlReviews.updateOne(
			{ _id: review._id },
			{ $set: { destination: DESTINATION, ...(status ? { status } : {}) } }
		);
		await answerBoth(locals, conv, review);
		return { conv, review };
	};
	const signIn = (userId: ObjectId) =>
		collections.sessions.updateOne(
			{ userId },
			{ $set: { oauth: { token: { value: "hf_owner" } } } as never }
		);
	const publishRow = (conversationId: ObjectId) =>
		collections.mcpElicitations.findOne({
			conversationId,
			"pending.kind": "ask",
			"pending.publish": { $exists: true },
		});
	const answer = (conversationId: ObjectId, elicitationId: string, choice?: string) =>
		submitElicitationAnswer({
			elicitationId,
			conversationId,
			action: choice ? "accept" : "cancel",
			...(choice ? { content: { publish: choice } } : {}),
		});

	it("submits without pushing, then parks the resumed turn on a publish card", async () => {
		vi.mocked(hub.commit).mockClear();
		const { locals, user } = await createTestUser();
		await signIn(user._id);
		const { conv, review } = await withDestination(locals);

		const res = await SUBMIT(
			event(locals, conv._id.toString(), review._id.toString(), {
				verdict: "approve",
				destination: { ...DESTINATION, repo: "ignored/now" },
			})
		);
		expect(res.status).toBe(200);
		expect(hub.commit).not.toHaveBeenCalled();

		const parked = await resumeParkedToolCall({
			conversationId: conv._id,
			elicitationId: review.elicitationId,
			generationId: "gen-resume",
			mayPark: true,
		});
		expect(parked.parkedAgain).toBe(true);
		const row = await publishRow(conv._id);
		expect(row).toMatchObject({
			status: "pending",
			generationId: "gen-resume",
			request: { source: "assistant", mode: "form", reviewId: review._id.toString() },
			pending: {
				kind: "ask",
				messageId: "msg-1",
				toolUuid: "uuid-1",
				publish: { reviewId: review._id.toString(), destination: DESTINATION, audience: AUDIENCE },
			},
		});
		const field = row?.request.fields?.[0];
		expect(field?.kind === "select" && field.options.map((o) => o.value)).toEqual([
			"push",
			"pr",
			"skip",
		]);
		expect(parked.updates.map((u) => [u.type, "subtype" in u ? u.subtype : undefined])).toEqual([
			["review", "resolved"],
			["elicitation", "resolved"],
			["elicitation", "request"],
			["turnState", undefined],
		]);
		expect(await collections.turnStates.findOne({ messageId: "msg-1" })).toMatchObject({
			status: "awaiting_input",
		});
		expect(await collections.mlReviews.findOne({ _id: review._id })).toMatchObject({
			destination: DESTINATION,
			publish: { promptId: row?.elicitationId, audience: AUDIENCE },
		});
		expect((await collections.mlReviews.findOne({ _id: review._id }))?.result).toBeUndefined();

		const again = await resumeParkedToolCall({
			conversationId: conv._id,
			elicitationId: review.elicitationId,
			generationId: "gen-repeat",
			mayPark: true,
		});
		expect(again.parkedAgain).toBe(true);
		expect(
			await collections.mcpElicitations.countDocuments({ "pending.publish": { $exists: true } })
		).toBe(1);
	});

	it("pushes, opens a PR, or skips on the card's answer, then hands the model the result", async () => {
		for (const [choice, expected] of [
			["push", "Labels pushed to pngwn/gold (data/a.parquet)"],
			["pr", "Labels pushed as a pull request on pngwn/gold (data/a.parquet)"],
			[
				"skip",
				"Labels were NOT pushed to pngwn/gold (data/a.parquet): the user chose not to push.",
			],
		] as const) {
			vi.mocked(hub.commit).mockClear();
			vi.mocked(hub.commit).mockResolvedValue({
				commit: { oid: "abc123", url: "https://huggingface.co/datasets/pngwn/gold/commit/abc123" },
				hookOutput: "",
				...(choice === "pr"
					? { pullRequestUrl: "https://huggingface.co/datasets/pngwn/gold/discussions/2" }
					: {}),
			});
			const { locals, user } = await createTestUser();
			await signIn(user._id);
			const { conv, review } = await withDestination(locals);
			await SUBMIT(
				event(locals, conv._id.toString(), review._id.toString(), { verdict: "approve" })
			);
			await resumeParkedToolCall({
				conversationId: conv._id,
				elicitationId: review.elicitationId,
				generationId: "gen-resume",
				mayPark: true,
			});
			const row = await publishRow(conv._id);
			if (!row) throw new Error("no publish card");
			expect(await answer(conv._id, row.elicitationId, choice)).toMatchObject({ ok: true });

			const { updates } = await resumeParkedToolCall({
				conversationId: conv._id,
				elicitationId: row.elicitationId,
			});
			const text = JSON.stringify(updates);
			expect(text).toContain(expected);
			expect(updates.at(-1)).toMatchObject({ type: "tool", subtype: "result", uuid: "uuid-1" });
			if (choice === "skip") {
				expect(hub.commit).not.toHaveBeenCalled();
				expect(await collections.mlReviews.findOne({ _id: review._id })).toMatchObject({
					declinedDestination: DESTINATION,
					publish: { decision: "skip" },
				});
			} else {
				expect(vi.mocked(hub.commit).mock.calls[0][0]).toMatchObject({
					accessToken: "hf_owner",
					...(choice === "pr" ? { isPullRequest: true } : { parentCommit: "head1" }),
				});
			}
			await collections.mcpElicitations.deleteMany({});
		}
	});

	it("never runs the ask answer path for a publish card, a budget grant included", async () => {
		vi.mocked(hub.commit).mockClear();
		const { locals, user } = await createTestUser();
		await signIn(user._id);
		const { conv, review } = await withDestination(locals);
		await SUBMIT(event(locals, conv._id.toString(), review._id.toString(), { verdict: "approve" }));
		await resumeParkedToolCall({
			conversationId: conv._id,
			elicitationId: review.elicitationId,
			generationId: "gen-resume",
			mayPark: true,
		});
		const row = await publishRow(conv._id);
		if (!row) throw new Error("no publish card");
		await collections.mcpElicitations.updateOne(
			{ _id: row._id },
			{ $set: { "request.fields.0.options.2.setBudgetUsd": 50 } }
		);
		const before = (await collections.conversations.findOne({ _id: conv._id }))?.mlBudget;

		expect(await answer(conv._id, row.elicitationId, "skip")).toMatchObject({ ok: true });
		expect((await collections.conversations.findOne({ _id: conv._id }))?.mlBudget).toEqual(before);

		const { updates } = await resumeParkedToolCall({
			conversationId: conv._id,
			elicitationId: row.elicitationId,
		});
		const text = JSON.stringify(updates);
		expect(text).toContain('Review \\"Triage batch 1\\" submitted');
		expect(text).not.toContain("The user answered");
		expect(text).not.toContain("compute budget");
	});

	it("offers no direct push to a repo the owner cannot write to", async () => {
		owner = "someone-else";
		const { locals, user } = await createTestUser();
		await signIn(user._id);
		const { conv, review } = await withDestination(locals);
		await SUBMIT(event(locals, conv._id.toString(), review._id.toString(), { verdict: "approve" }));
		await resumeParkedToolCall({
			conversationId: conv._id,
			elicitationId: review.elicitationId,
			generationId: "gen-resume",
			mayPark: true,
		});
		const field = (await publishRow(conv._id))?.request.fields?.[0];
		expect(field?.kind === "select" && field.options.map((o) => o.value)).toEqual(["pr", "skip"]);
	});

	it("closes an open card as not pushed when the user writes instead", async () => {
		vi.mocked(hub.commit).mockClear();
		const { locals, user } = await createTestUser();
		await signIn(user._id);
		const { conv, review } = await withDestination(locals);
		await SUBMIT(event(locals, conv._id.toString(), review._id.toString(), { verdict: "approve" }));
		await resumeParkedToolCall({
			conversationId: conv._id,
			elicitationId: review.elicitationId,
			generationId: "gen-resume",
			mayPark: true,
		});
		const fresh = await collections.conversations.findOne({ _id: conv._id });
		if (!fresh) throw new Error("no conversation");
		fresh.messages.push({ id: "msg-1", from: "assistant", content: "", updates: [] } as never);

		await detachOpenReviews(fresh);

		expect(await publishRow(conv._id)).toMatchObject({
			status: "resolved",
			resolution: "withdrawn",
			resume: { status: "abandoned" },
		});
		const message = fresh.messages.find((m) => m.id === "msg-1");
		expect(JSON.stringify(message?.updates)).toContain(
			"the user wrote instead of answering the publish card"
		);
		expect(hub.commit).not.toHaveBeenCalled();
	});

	it("holds a detached review's message until its card is answered", async () => {
		vi.mocked(hub.commit).mockClear();
		vi.mocked(hub.commit).mockResolvedValue({
			commit: { oid: "abc123", url: "https://huggingface.co/datasets/pngwn/gold/commit/abc123" },
			hookOutput: "",
		});
		deliverReview.mockClear();
		const { locals, user } = await createTestUser();
		await signIn(user._id);
		const { conv, review } = await withDestination(locals, "detached");

		const res = await SUBMIT(
			event(locals, conv._id.toString(), review._id.toString(), { verdict: "approve" })
		);
		const body = await res.json();
		const row = await publishRow(conv._id);
		expect(body).toMatchObject({
			ok: true,
			delivery: "queued",
			publishPromptId: row?.elicitationId,
		});
		expect(row?.pending).toMatchObject({ publish: { deliver: true } });
		expect(await collections.mlReviews.findOne({ _id: review._id })).toMatchObject({
			delivery: { status: "held" },
		});
		expect(deliverReview).not.toHaveBeenCalled();

		if (!row) throw new Error("no publish card");
		await answer(conv._id, row.elicitationId, "push");
		const { updates } = await resumeParkedToolCall({
			conversationId: conv._id,
			elicitationId: row.elicitationId,
		});
		expect(updates.some((u) => u.type === "tool")).toBe(false);
		expect(hub.commit).toHaveBeenCalledTimes(1);
		expect(await collections.mlReviews.findOne({ _id: review._id })).toMatchObject({
			delivery: { status: "pending" },
		});
		expect(deliverReview).toHaveBeenCalledWith(review._id);
	});

	it("serves media to the owner only", async () => {
		const { locals: owner } = await createTestUser();
		const { locals: other } = await createTestUser();
		const { conv, review } = await seed(owner);
		const media = (locals: App.Locals, index: string, field: string) =>
			MEDIA({
				locals,
				params: { id: conv._id.toString(), reviewId: review._id.toString(), index, field },
				request: new Request("http://localhost/media"),
			} as never);
		expect(await statusOf(media(other, "0", "body"))).toBe(404);
		expect(await statusOf(media(owner, "0", "body"))).toBe(404);
		expect(await statusOf(media(owner, "9", "body"))).toBe(404);
	});
});
