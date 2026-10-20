import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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
		expect(await submitReview(read, { verdict: "approve" })).toBe(true);

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

	it("rebuilds a lost result from the files its first attempt wrote", async () => {
		const { locals } = await createTestUser();
		const { conv, review } = await seed(locals);
		await labelBoth(locals, conv, review);
		const read = await collections.mlReviews.findOne({ _id: review._id });
		if (!read) throw new Error("review vanished");
		expect(await submitReview(read, { verdict: "approve" })).toBe(true);
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
		expect(await submitReview(read, { verdict: "approve" })).toBe(true);

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

	it("refuses a submit with no record approved, rejected or answered", async () => {
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
		const submit = () =>
			errorOf(
				SUBMIT(event(locals, conv._id.toString(), review._id.toString(), { verdict: "approve" }))
			);
		const nothing = {
			status: 400,
			message: "Approve, reject or answer at least one record before submitting.",
		};

		expect(await submit()).toEqual(nothing);
		await PATCH(
			event(locals, conv._id.toString(), review._id.toString(), {
				index: 0,
				draft: { status: "skipped", answers: {}, comments: [] },
			})
		);
		expect(await submit()).toEqual(nothing);
		expect((await collections.mlReviews.findOne({ _id: review._id }))?.status).toBe("open");
		expect(await collections.mlFiles.countDocuments({ conversationId: conv._id })).toBe(0);
	});

	it("words a review with no questions as approved and rejected, listing the ids", async () => {
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
		expect(text).toContain("Records: 2 approved, 1 rejected, 1 skipped, 0 not reviewed (of 4).");
		expect(text).toContain("Approved: a, c\nRejected: b\n");
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
			expect(review.result?.text).toContain("Approved: a, d\nRejected: c\n");
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

		it("cannot answer a required label for the user, so the blockers still stand", async () => {
			const { locals } = await createTestUser();
			const { submit, stored } = await reviewWith(locals, SCHEMA.questions);
			const res = await SUBMIT(
				event(locals, (await stored()).conversationId.toString(), (await stored())._id.toString(), {
					verdict: "approve",
					approveRest: true,
				})
			);
			expect(res.status).toBe(400);
			expect((await res.json()).blockers).toHaveLength(4);
			expect(await stored()).toMatchObject({ status: "detached", drafts: {} });
			expect((await submit({ verdict: "approve" })).status).toBe(400);
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

	it("answers 400 with the blockers while a required question is open", async () => {
		const { locals } = await createTestUser();
		const { conv, review } = await seed(locals);
		await PATCH(
			event(locals, conv._id.toString(), review._id.toString(), {
				index: 0,
				draft: draft({ kind: "bug" }),
			})
		);

		const res = await SUBMIT(
			event(locals, conv._id.toString(), review._id.toString(), { verdict: "approve" })
		);

		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({
			message: "Some records still need answers.",
			blockers: [{ record: 1, question: "kind", reason: "required" }],
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
				verdict: "comment",
				summary: "Mostly fine.",
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
		expect(body.text).toContain('Verdict: comment. "Mostly fine."');
		expect(body.text).toContain(
			"Records: 2 answered, 0 skipped, 0 discarded, 0 not reviewed (of 2)."
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
			verdict: "comment",
			summary: "Mostly fine.",
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
