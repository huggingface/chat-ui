import { error } from "@sveltejs/kit";
import { BSON, ObjectId } from "mongodb";
import { z } from "zod";
import { collections } from "$lib/server/database";
import { authCondition } from "$lib/server/auth";
import { logger } from "$lib/server/logger";
import { kickAnsweredAsk, type AskResumeSelection } from "$lib/server/generation/askResume";
import type { MlReview, ReviewDestination, ReviewDraft } from "$lib/types/MlReview";
import {
	invalidAnswers,
	isAnswered,
	validateAnswer,
	type ReviewBlocker,
} from "$lib/utils/review/answers";
import { REVIEW_LIMITS } from "$lib/utils/review/schema";
import { readReview, saveDraft, saveDraftsGuarded, submitReview } from "./store";
import { completeSubmission } from "./submission";
import { deliverReview, type DeliveryState } from "./delivery";
import { REVIEW_MAX_RECORDS } from "$lib/server/textGeneration/builtinTools/requestReviewDefinition";
import { parseDestination, sameDestination } from "./destination";
import { reviewSlug } from "./result";

export const REVIEW_MAX_COMMENTS_PER_RECORD = REVIEW_LIMITS.commentsPerRecord;
export const REVIEW_MAX_COMMENT_CHARS = REVIEW_LIMITS.commentChars;
export const REVIEW_MAX_COMMENTS = REVIEW_LIMITS.comments;
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
		...((review.note ?? review.summary) ? { note: review.note ?? review.summary } : {}),
		...(review.result ? { result: review.result } : {}),
		...(review.submitFailure?.gaveUp ? { submitFailed: review.submitFailure.error } : {}),
		...(review.destination ? { destination: review.destination } : {}),
		...(review.declinedDestination ? { declinedDestination: review.declinedDestination } : {}),
		...(review.push
			? {
					push: {
						status: review.push.status,
						...(review.push.url ? { url: review.push.url } : {}),
						...(review.push.path ? { path: review.push.path } : {}),
						...(review.push.pr !== undefined ? { pr: review.push.pr } : {}),
						...(review.push.error ? { error: review.push.error } : {}),
					},
				}
			: {}),
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

const BUSY = "This review is being saved from elsewhere, try again.";
/** a guarded save loses to any other save of the review, so it reads again a few times */
const SAVE_RETRIES = 3;

type DraftComment = z.infer<typeof comment>;

function checkComments(review: MlReview, comments: DraftComment[], at: string) {
	const fieldTypes = new Map(review.schema.fields.map((f) => [f.name, f.type]));
	for (const [i, c] of comments.entries()) {
		const path = `${at}.${i}`;
		if (c.field !== undefined && !fieldTypes.has(c.field)) {
			error(400, `comments: no field "${c.field}"`);
		}
		const type = c.field === undefined ? undefined : fieldTypes.get(c.field);
		if (c.quote && (c.area || c.time)) {
			error(400, `${path}: a quote cannot also carry an area or a time`);
		}
		if (c.quote && type !== "text" && type !== "markdown" && type !== "code") {
			error(400, `${path}.quote: a quote is only on a text, markdown or code field`);
		}
		if (c.time && type !== "audio" && type !== "video") {
			error(400, `${path}.time: a time is only on an audio or video field`);
		}
		if (c.area && type !== "image" && type !== "video") {
			error(400, `${path}.area: an area is only on an image or video field`);
		}
		if (c.area && type === "video" && !c.time) {
			error(400, `${path}.time: a box on a video needs the frame time in time.start`);
		}
	}
}

const storedComment = (c: DraftComment, now: Date): ReviewDraft["comments"][number] => ({
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
});

function checkDraftBytes(review: MlReview, replaced: Record<string, ReviewDraft>) {
	const others = Object.entries(review.drafts)
		.filter(([key, d]) => !(key in replaced) && d)
		.reduce((sum, [, d]) => sum + BSON.calculateObjectSize(d as ReviewDraft), 0);
	const added = Object.values(replaced).reduce((sum, d) => sum + BSON.calculateObjectSize(d), 0);
	if (others + added > REVIEW_MAX_DRAFT_BYTES) {
		error(
			413,
			`This review's answers have reached the ${REVIEW_MAX_DRAFT_BYTES / 1024 / 1024} MB limit. Shorten long answers, or submit this batch and review the rest in another.`
		);
	}
}

const commentTotal = (review: MlReview, except?: string) =>
	Object.entries(review.drafts)
		.filter(([key]) => key !== except)
		.reduce((sum, [, d]) => sum + (d?.comments?.length ?? 0), 0);

/** reads the review again after a guarded save lost, or gives up once the retries are spent */
async function reread(review: MlReview, attempt: number): Promise<MlReview> {
	const fresh = await readReview(review.conversationId, review._id.toString());
	if (!fresh || fresh.status === "submitted" || fresh.status === "expired") {
		error(409, "This review is closed.");
	}
	if (attempt + 1 >= SAVE_RETRIES) error(409, BUSY);
	return fresh;
}

export type DraftPatchOutcome =
	| { problems: DraftProblem[]; revision: number }
	| { conflict: ReviewDraft | undefined }
	| { revisions: Record<string, number> };

/** kept whatever its validity so a half typed answer survives a reload */
export async function patchDraft(
	review: MlReview,
	body: unknown,
	attempt = 0
): Promise<DraftPatchOutcome> {
	if (review.status === "submitted") error(409, "This review was already submitted.");
	if (review.status === "expired") error(409, "This review expired.");
	if (body && typeof body === "object" && "bulk" in body) {
		return patchBulk(review, (body as { bulk: unknown }).bulk, attempt);
	}
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
	checkComments(review, draft.comments, "draft.comments");
	const current = review.drafts[String(index)];
	if (baseRevision !== undefined && (current?.revision ?? 0) !== baseRevision) {
		return { conflict: current };
	}
	if (commentTotal(review, String(index)) + draft.comments.length > REVIEW_MAX_COMMENTS) {
		error(400, `a review holds at most ${REVIEW_MAX_COMMENTS} comments`);
	}

	const now = new Date();
	const stored: ReviewDraft = {
		status: draft.status,
		answers: draft.answers,
		comments: draft.comments.map((c) => storedComment(c, now)),
		revision: (current?.revision ?? 0) + 1,
		updatedAt: now,
	};
	checkDraftBytes(review, { [String(index)]: stored });

	// a save that may add comments is guarded on the whole review, so the cap above stays true,
	// one with no base revision may land on a record that lost comments since the read
	const addsComments =
		draft.comments.length > (current?.comments?.length ?? 0) ||
		(baseRevision === undefined && draft.comments.length > 0);
	if (addsComments) {
		const saved = await saveDraftsGuarded(review, { [String(index)]: stored });
		if (saved === "closed") error(409, "This review is closed.");
		if (saved === "moved") return patchDraft(await reread(review, attempt), body, attempt + 1);
	} else {
		const saved = await saveDraft(
			review.conversationId,
			review._id.toString(),
			index,
			stored,
			baseRevision
		);
		if (saved === "closed") error(409, "This review is closed.");
		if (saved === "conflict") {
			const fresh = await readReview(review.conversationId, review._id.toString());
			return { conflict: fresh?.drafts[String(index)] };
		}
	}

	const problems: DraftProblem[] = [];
	for (const [name, value] of Object.entries(draft.answers)) {
		const question = questions.get(name);
		const reason = question ? validateAnswer(question, value) : undefined;
		if (reason) problems.push({ question: name, reason });
	}
	return { problems, revision: stored.revision ?? 1 };
}

export const bulkDraftSchema = z
	.object({
		indexes: z.array(z.number().int().nonnegative()).min(1).max(REVIEW_MAX_RECORDS),
		status: z.enum(["pending", "answered", "skipped", "discarded"]).optional(),
		answers: z.record(z.string(), answerValue.nullable()).optional(),
		addComment: comment.omit({ quote: true, createdAt: true }).optional(),
	})
	.refine((bulk) => bulk.status || bulk.answers || bulk.addComment, {
		message: "give a status, answers or a comment to apply",
	});

/** one change to many records in one guarded write, as grid select and mark sends it */
async function patchBulk(
	review: MlReview,
	raw: unknown,
	attempt: number
): Promise<DraftPatchOutcome> {
	const parsed = bulkDraftSchema.safeParse(raw);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		error(400, `bulk.${issue?.path.join(".") ?? ""}: ${issue?.message ?? "invalid"}`);
	}
	const bulk = parsed.data;
	if (new Set(bulk.indexes).size !== bulk.indexes.length)
		error(400, "bulk.indexes: repeats an index");
	const outside = bulk.indexes.find((index) => index >= review.records.length);
	if (outside !== undefined) {
		error(
			400,
			`bulk.indexes: the review has ${review.records.length} records, ${outside} is past them`
		);
	}
	const questions = new Map(review.schema.questions.map((q) => [q.name, q]));
	for (const [name, value] of Object.entries(bulk.answers ?? {})) {
		const question = questions.get(name);
		if (!question) error(400, `bulk.answers.${name}: no such question`);
		const reason = value === null ? undefined : validateAnswer(question, value);
		if (reason) error(400, `bulk.answers.${name}: ${reason}`);
	}
	if (bulk.addComment) checkComments(review, [bulk.addComment], "bulk.addComment");

	if (bulk.addComment) {
		const left = REVIEW_MAX_COMMENTS - commentTotal(review);
		if (bulk.indexes.length > left) {
			error(
				400,
				`a review holds at most ${REVIEW_MAX_COMMENTS} comments, ${Math.max(left, 0)} left`
			);
		}
	}

	const now = new Date();
	const drafts: Record<string, ReviewDraft> = {};
	for (const index of bulk.indexes) {
		const current = review.drafts[String(index)];
		const answers = { ...(current?.answers ?? {}) };
		for (const [name, value] of Object.entries(bulk.answers ?? {})) {
			if (value === null) delete answers[name];
			else answers[name] = value;
		}
		const comments = [...(current?.comments ?? [])];
		if (bulk.addComment) {
			if (comments.length >= REVIEW_MAX_COMMENTS_PER_RECORD) {
				error(
					400,
					`record ${index} already has ${REVIEW_MAX_COMMENTS_PER_RECORD} comments, the most one record holds`
				);
			}
			comments.push(
				storedComment({ ...bulk.addComment, id: `${bulk.addComment.id}-${index}` }, now)
			);
		}
		drafts[String(index)] = {
			status:
				bulk.status ??
				(bulk.answers ? answeredStatus(review.schema, answers) : (current?.status ?? "pending")),
			answers,
			comments,
			revision: (current?.revision ?? 0) + 1,
			updatedAt: now,
		};
	}
	checkDraftBytes(review, drafts);

	const saved = await saveDraftsGuarded(review, drafts);
	if (saved === "closed") error(409, "This review is closed.");
	if (saved === "moved") {
		return patchDraft(await reread(review, attempt), { bulk: raw }, attempt + 1);
	}
	return {
		revisions: Object.fromEntries(
			Object.entries(drafts).map(([index, draft]) => [index, draft.revision ?? 1])
		),
	};
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
	// an older pane still sends a verdict and summary, both are ignored
	note: z.string().trim().max(SUMMARY_CHARS).optional(),
	selection: selectionSchema,
	/** marks every record still undecided ok, so marking all is one request at 500 records */
	approveRest: z.boolean().optional(),
	/** the review destination sent back to confirm the push, null or absent pushes nothing */
	destination: z.unknown().optional(),
});

/** mirrors the pane, a record is answered once its required questions are, or any when none is */
function answeredStatus(
	schema: MlReview["schema"],
	answers: ReviewDraft["answers"]
): ReviewDraft["status"] {
	const required = schema.questions.filter((question) => question.required);
	const done =
		required.length > 0
			? required.every((question) => isAnswered(answers[question.name]))
			: schema.questions.some((question) => isAnswered(answers[question.name]));
	return done ? "answered" : "pending";
}

/** approval sets the first yes or no question, or with none just marks the record answered */
function approvalsForRest(review: MlReview): Record<string, ReviewDraft> {
	const yesNo = review.schema.questions.find((question) => question.type === "boolean");
	const now = new Date();
	const approved: Record<string, ReviewDraft> = {};
	for (let index = 0; index < review.records.length; index += 1) {
		const draft = review.drafts[String(index)];
		if (draft && draft.status !== "pending") continue;
		// a no the user already gave stands, approving the rest never flips it
		if (yesNo && isAnswered(draft?.answers?.[yesNo.name])) continue;
		const answers = { ...(draft?.answers ?? {}), ...(yesNo ? { [yesNo.name]: true } : {}) };
		approved[String(index)] = {
			status: yesNo ? answeredStatus(review.schema, answers) : "answered",
			answers,
			comments: draft?.comments ?? [],
			revision: (draft?.revision ?? 0) + 1,
			updatedAt: now,
		};
	}
	return approved;
}

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
	const { selection } = parsed.data;
	const note = parsed.data.note || undefined;

	if (review.status === "submitted") {
		// a retry finishes what a dead process left and answers with the same outcome
		if (!review.unresolved && !review.delivery) error(409, "This review was already submitted.");
		return finish(review, selection);
	}

	// only a destination the user saw and sent back publishes, a submit without one pushes nothing
	let confirmed: ReviewDestination | undefined;
	if (parsed.data.destination !== undefined && parsed.data.destination !== null) {
		const given = parseDestination(
			parsed.data.destination,
			review.destination?.path ?? `data/${reviewSlug(review.schema.title)}.parquet`
		);
		if ("error" in given) error(400, given.error);
		if (!review.destination || !sameDestination(given, review.destination)) {
			error(400, "The destination does not match this review's, reload it and confirm again.");
		}
		confirmed = review.destination;
	}
	const declined = confirmed ? undefined : review.destination;

	const approved = parsed.data.approveRest ? approvalsForRest(review) : {};
	const drafts = { ...review.drafts, ...approved };
	const found = invalidAnswers(review.schema, drafts, review.records.length);
	if (found.length > 0) return { blockers: found };

	const from = review.status;
	if (
		!(await submitReview(review, { note, drafts: approved, confirmed, declined }, from))
	) {
		error(409, "This review changed while it was being submitted, reload it and submit again.");
	}
	const claimed: MlReview = {
		...review,
		drafts,
		destination: confirmed,
		...(declined ? { declinedDestination: declined } : {}),
		status: "submitted",
		...(note ? { note } : {}),
		...(from === "open" ? { unresolved: true as const } : {}),
		submittedAt: new Date(),
	};
	return finish(claimed, selection);
}

async function finish(
	review: MlReview,
	selection: z.infer<typeof selectionSchema>
): Promise<SubmitOutcome> {
	const { files, resolved } = await completeSubmission(review);
	if (resolved) {
		await resume(review, selection);
		return { ok: true, files };
	}
	// a detached turn moved on, or a message sent meanwhile closed the call, so post it as one
	if (review.destination) {
		// its message carries the push link and a commit can take a minute
		deliverReview(review._id, toResumeSelection(selection)).catch((err) =>
			logger.error({ err, reviewId: review._id.toString() }, "[review] delivery failed")
		);
		return { ok: true, files, delivery: "queued" };
	}
	return {
		ok: true,
		files,
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
