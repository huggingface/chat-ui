import { error } from "@sveltejs/kit";
import { BSON, ObjectId } from "mongodb";
import { z } from "zod";
import { collections } from "$lib/server/database";
import { authCondition } from "$lib/server/auth";
import { logger } from "$lib/server/logger";
import { kickAnsweredAsk, type AskResumeSelection } from "$lib/server/generation/askResume";
import type { MlReview, ReviewDraft } from "$lib/types/MlReview";
import { blockers, validateAnswer, type ReviewBlocker } from "$lib/utils/review/answers";
import { REVIEW_LIMITS } from "$lib/utils/review/schema";
import { readReview, saveDraft, submitReview } from "./store";
import { completeSubmission } from "./submission";
import { deliverReview, type DeliveryState } from "./delivery";

export const REVIEW_MAX_COMMENTS_PER_RECORD = 20;
export const REVIEW_MAX_COMMENT_CHARS = 2_000;
export const REVIEW_MAX_COMMENTS = 200;
export const NOTHING_DECIDED = "Approve, reject or answer at least one record before submitting.";
/** records cap at 4 MB, so 8 MiB of drafts keeps the row under the 16 MiB mongo limit */
export const REVIEW_MAX_DRAFT_BYTES = 8 * 1024 * 1024;
const QUOTE_EXACT_CHARS = 2_000;
const QUOTE_CONTEXT_CHARS = 64;
const SUMMARY_CHARS = 4_000;

/** owner only, a share id is a snapshot its reader does not own, and another user sees nothing */
export async function ownedReview(
	locals: App.Locals,
	id: string,
	reviewId: string
): Promise<MlReview> {
	if (!locals.user?._id && !locals.sessionId) error(401, "Must have a valid session or user");
	if (id.length === 7 || !ObjectId.isValid(id)) error(404, "Review not found");
	const conversation = await collections.conversations.findOne(
		{ _id: new ObjectId(id), ...authCondition(locals) },
		{ projection: { _id: 1 } }
	);
	if (!conversation) error(404, "Review not found");
	const review = await readReview(conversation._id, reviewId);
	if (!review) error(404, "Review not found");
	return review;
}

export function reviewPayload(review: MlReview) {
	return {
		id: review._id.toString(),
		schema: review.schema,
		schemaHash: review.schemaHash,
		records: review.records,
		drafts: review.drafts,
		status: review.status,
		...(review.verdict ? { verdict: review.verdict } : {}),
		...(review.summary ? { summary: review.summary } : {}),
		...(review.result ? { result: review.result } : {}),
		...(review.delivery
			? {
					delivery: {
						status: review.delivery.status,
						...(review.delivery.messageId ? { messageId: review.delivery.messageId } : {}),
					},
				}
			: {}),
		createdAt: review.createdAt,
		updatedAt: review.updatedAt,
	};
}

const answerValue = z.union([
	z.string().max(REVIEW_LIMITS.textChars),
	z.number(),
	z.boolean(),
	z.array(z.string().max(REVIEW_LIMITS.optionChars)).max(REVIEW_LIMITS.maxOptions),
]);

/** a day is far past any clip a review shows, and keeps a typo from reading as a time */
const MAX_SECONDS = 24 * 60 * 60;
const FLOAT_SLACK = 1e-9;
const fraction = z.number().finite().min(0).max(1);
const seconds = z.number().finite().min(0).max(MAX_SECONDS);

const area = z
	.object({ x: fraction, y: fraction, w: fraction.gt(0), h: fraction.gt(0) })
	.refine((a) => a.x + a.w <= 1 + FLOAT_SLACK, { message: "x + w must not exceed 1", path: ["w"] })
	.refine((a) => a.y + a.h <= 1 + FLOAT_SLACK, { message: "y + h must not exceed 1", path: ["h"] });

const time = z
	.object({ start: seconds, end: seconds.optional() })
	.refine((t) => t.end === undefined || t.end > t.start, {
		message: "end must be after start",
		path: ["end"],
	});

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

const comment = z.object({
	id: z.string().min(1).max(64),
	field: z.string().optional(),
	area: area.optional(),
	time: time.optional(),
	quote: z
		.object({
			exact: z.string().min(1).max(QUOTE_EXACT_CHARS),
			prefix: z.string().max(QUOTE_CONTEXT_CHARS),
			suffix: z.string().max(QUOTE_CONTEXT_CHARS),
		})
		.optional(),
	body: z
		.string()
		.trim()
		.min(1, "a comment needs text")
		.max(REVIEW_MAX_COMMENT_CHARS, `a comment is at most ${REVIEW_MAX_COMMENT_CHARS} characters`),
	createdAt: z.coerce.date().optional(),
});

export const draftBodySchema = z.object({
	index: z.number().int().nonnegative(),
	baseRevision: z.number().int().nonnegative().optional(),
	draft: z.object({
		status: z.enum(["pending", "answered", "skipped", "discarded"]),
		answers: z.record(z.string(), answerValue).default({}),
		comments: z
			.array(comment)
			.max(
				REVIEW_MAX_COMMENTS_PER_RECORD,
				`at most ${REVIEW_MAX_COMMENTS_PER_RECORD} comments on one record`
			)
			.default([]),
	}),
});

export interface DraftProblem {
	question: string;
	reason: string;
}

/** kept whatever its validity so a half typed answer survives a reload */
export async function patchDraft(
	review: MlReview,
	body: unknown
): Promise<{ problems: DraftProblem[]; revision: number } | { conflict: ReviewDraft | undefined }> {
	if (review.status === "submitted") error(409, "This review was already submitted.");
	if (review.status === "expired") error(409, "This review expired.");
	const parsed = draftBodySchema.safeParse(body);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		error(400, `${issue?.path.join(".") ?? "body"}: ${issue?.message ?? "invalid"}`);
	}
	const { index, draft, baseRevision } = parsed.data;
	if (index >= review.records.length)
		error(400, `index: the review has ${review.records.length} records`);

	// answer keys become Mongo keys, so only the declared names get in
	const questions = new Map(review.schema.questions.map((q) => [q.name, q]));
	for (const name of Object.keys(draft.answers)) {
		if (!questions.has(name)) error(400, `answers.${name}: no such question`);
	}
	const fields = new Set(review.schema.fields.map((f) => f.name));
	const fieldTypes = new Map(review.schema.fields.map((f) => [f.name, f.type]));
	for (const [i, c] of draft.comments.entries()) {
		const at = `draft.comments.${i}`;
		if (c.field !== undefined && !fields.has(c.field))
			error(400, `comments: no field "${c.field}"`);
		const type = c.field === undefined ? undefined : fieldTypes.get(c.field);
		if (c.quote && (c.area || c.time))
			error(400, `${at}: a quote cannot also carry an area or a time`);
		if (c.quote && type !== "text" && type !== "markdown" && type !== "code") {
			error(400, `${at}.quote: a quote is only on a text, markdown or code field`);
		}
		if (c.time && type !== "audio" && type !== "video") {
			error(400, `${at}.time: a time is only on an audio or video field`);
		}
		if (c.area && type !== "image" && type !== "video") {
			error(400, `${at}.area: an area is only on an image or video field`);
		}
		if (c.area && type === "video" && !c.time) {
			error(400, `${at}.time: a box on a video needs the frame time in time.start`);
		}
	}
	const elsewhere = Object.entries(review.drafts)
		.filter(([key]) => key !== String(index))
		.reduce((sum, [, d]) => sum + (d?.comments?.length ?? 0), 0);
	if (elsewhere + draft.comments.length > REVIEW_MAX_COMMENTS) {
		error(400, `a review holds at most ${REVIEW_MAX_COMMENTS} comments`);
	}

	const now = new Date();
	const stored: ReviewDraft = {
		status: draft.status,
		answers: draft.answers,
		comments: draft.comments.map((c) => ({
			id: c.id,
			...(c.field !== undefined ? { field: c.field } : {}),
			...(c.quote ? { quote: c.quote } : {}),
			...(c.area
				? {
						area: {
							x: round4(c.area.x),
							y: round4(c.area.y),
							w: round4(c.area.w),
							h: round4(c.area.h),
						},
					}
				: {}),
			...(c.time ? { time: c.time } : {}),
			body: c.body,
			createdAt: c.createdAt ?? now,
		})),
		revision: (baseRevision ?? review.drafts[String(index)]?.revision ?? 0) + 1,
		updatedAt: now,
	};
	const draftBytes = Object.entries(review.drafts)
		.filter(([key, d]) => key !== String(index) && d)
		.reduce((sum, [, d]) => sum + BSON.calculateObjectSize(d as ReviewDraft), 0);
	if (draftBytes + BSON.calculateObjectSize(stored) > REVIEW_MAX_DRAFT_BYTES) {
		error(
			413,
			`This review's answers have reached the ${REVIEW_MAX_DRAFT_BYTES / 1024 / 1024} MB limit. Shorten long answers, or submit this batch and review the rest in another.`
		);
	}
	const saved = await saveDraft(
		review.conversationId,
		review._id.toString(),
		index,
		stored,
		baseRevision
	);
	if (saved === "closed") error(409, "This review is closed.");
	if (saved === "conflict") {
		const current = await readReview(review.conversationId, review._id.toString());
		return { conflict: current?.drafts[String(index)] };
	}

	const problems: DraftProblem[] = [];
	for (const [name, value] of Object.entries(draft.answers)) {
		const question = questions.get(name);
		const reason = question ? validateAnswer(question, value) : undefined;
		if (reason) problems.push({ question: name, reason });
	}
	return { problems, revision: stored.revision ?? 1 };
}

const selectionSchema = z
	.object({
		selectedMcpServerNames: z.array(z.string()).optional(),
		selectedMcpServers: z
			.array(
				z.object({
					name: z.string(),
					url: z.string(),
					headers: z.array(z.object({ key: z.string(), value: z.string() })).optional(),
				})
			)
			.optional(),
		timezone: z.string().optional(),
	})
	.optional();

export const submitBodySchema = z.object({
	verdict: z.enum(["approve", "request_changes", "comment"]),
	summary: z.string().trim().max(SUMMARY_CHARS).optional(),
	selection: selectionSchema,
});

function toResumeSelection(selection: z.infer<typeof selectionSchema>): AskResumeSelection {
	return {
		...(selection?.selectedMcpServerNames
			? { selectedServerNames: selection.selectedMcpServerNames }
			: {}),
		...(selection?.selectedMcpServers
			? {
					selectedServers: selection.selectedMcpServers.map((server) => ({
						name: server.name,
						url: server.url,
						...(server.headers?.length
							? { headers: Object.fromEntries(server.headers.map((h) => [h.key, h.value])) }
							: {}),
					})),
				}
			: {}),
		...(selection?.timezone ? { timezone: selection.timezone } : {}),
	};
}

export type SubmitOutcome =
	| {
			ok: true;
			files: NonNullable<MlReview["result"]>["files"];
			/** set when the turn had moved on and the submission goes out as the next user message */
			delivery?: DeliveryState;
	  }
	| { blockers: ReviewBlocker[] };

export async function submitReviewRequest(review: MlReview, body: unknown): Promise<SubmitOutcome> {
	if (review.status === "expired") error(409, "This review expired.");
	const parsed = submitBodySchema.safeParse(body);
	if (!parsed.success) error(400, "Invalid review submission");
	const { verdict, selection } = parsed.data;
	const summary = parsed.data.summary || undefined;

	if (review.status === "submitted") {
		// a retry finishes what a dead process left and answers with the same outcome
		if (!review.unresolved && !review.delivery) error(409, "This review was already submitted.");
		return finish(review, selection);
	}

	const found = blockers(review.schema, review.drafts, review.records.length);
	if (found.length > 0) return { blockers: found };
	const decided = Object.values(review.drafts).some(
		(d) => d?.status === "answered" || d?.status === "discarded"
	);
	if (!decided) error(400, NOTHING_DECIDED);

	const from = review.status;
	if (!(await submitReview(review, { verdict, summary }, from))) {
		error(409, "This review changed while it was being submitted, reload it and submit again.");
	}
	const claimed: MlReview = {
		...review,
		status: "submitted",
		verdict,
		...(summary ? { summary } : {}),
		...(from === "open" ? { unresolved: true as const } : {}),
		submittedAt: new Date(),
	};
	return finish(claimed, selection);
}

async function finish(
	review: MlReview,
	selection: z.infer<typeof selectionSchema>
): Promise<SubmitOutcome> {
	const { result, resolved } = await completeSubmission(review);
	if (resolved) {
		await resume(review, selection);
		return { ok: true, files: result.files };
	}
	// a detached turn moved on, or a message sent meanwhile closed the call, so post it as one
	return {
		ok: true,
		files: result.files,
		delivery: await deliverReview(review._id, toResumeSelection(selection)),
	};
}

async function resume(review: MlReview, selection: z.infer<typeof selectionSchema>) {
	const outcome = await kickAnsweredAsk(
		review.conversationId,
		review.elicitationId,
		toResumeSelection(selection),
		"review"
	);
	if (outcome === "failed") {
		logger.warn({ reviewId: review._id.toString() }, "[review] resume failed, the sweep retries");
	}
}
