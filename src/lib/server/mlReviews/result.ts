import { collections } from "$lib/server/database";
import { ML_FILE_MAX_BYTES, writeMlFileVersion } from "$lib/server/mlFiles";
import { storeReviewResult } from "./store";
import { formatVirtualFileRef } from "$lib/server/mlFiles/refs";
import type { MlFileRef } from "$lib/types/MlFile";
import type {
	MlReview,
	ReviewAnswer,
	ReviewComment,
	ReviewDraft,
	ReviewDatasetVia,
	ReviewPush,
	ReviewQuestion,
	ReviewSource,
} from "$lib/types/MlReview";
import {
	MessageReviewUpdateType,
	MessageUpdateType,
	type MessageReviewResolvedUpdate,
} from "$lib/types/MessageUpdate";
import { isAnswered, recordStatus } from "$lib/utils/review/answers";
import { destinationUrl, pushReviewLabels } from "./destination";

/** the submit carries no verdict, so the model reads the annotations and the user decides */
export const REVIEW_NEXT_STEPS =
	"Next: summarise for the user what these annotations mean, propose next steps, and ask before anything that costs compute or publishes.";

/** what comments and inline answers may add to the tool message, which a review row also stores */
export const REVIEW_RESULT_BUDGET_CHARS = 48_000;

/** at or under this many records the answers go in the tool message too */
export const REVIEW_INLINE_ANSWERS = 20;
const QUOTE_CHARS = 80;

export interface ReviewCounts {
	total: number;
	answered: number;
	skipped: number;
	discarded: number;
	pending: number;
	comments: number;
}

const draftAt = (review: Pick<MlReview, "drafts">, index: number): ReviewDraft | undefined =>
	review.drafts[String(index)];

export function reviewCounts(
	review: Pick<MlReview, "drafts" | "records" | "schema">
): ReviewCounts {
	const counts: ReviewCounts = {
		total: review.records.length,
		answered: 0,
		skipped: 0,
		discarded: 0,
		pending: 0,
		comments: 0,
	};
	for (let index = 0; index < review.records.length; index += 1) {
		const draft = draftAt(review, index);
		counts[recordStatus(review.schema, draft)] += 1;
		counts.comments += draft?.comments?.length ?? 0;
	}
	return counts;
}

export function reviewResolvedUpdate(
	review: Pick<MlReview, "_id" | "drafts" | "records" | "result" | "schema">
): MessageReviewResolvedUpdate {
	const counts = reviewCounts(review);
	return {
		type: MessageUpdateType.Review,
		subtype: MessageReviewUpdateType.Resolved,
		reviewId: review._id.toString(),
		answered: counts.answered,
		skipped: counts.skipped,
		comments: counts.comments,
		files: review.result?.files ?? [],
		...(review.result?.pushed
			? { pushed: { url: review.result.pushed.url, pr: review.result.pushed.pr } }
			: {}),
	};
}

const sameAnswer = (a: ReviewAnswer, b: ReviewAnswer): boolean =>
	Array.isArray(a) && Array.isArray(b)
		? a.length === b.length && [...a].sort().join("\u0000") === [...b].sort().join("\u0000")
		: a === b;

const showAnswer = (value: ReviewAnswer): string =>
	Array.isArray(value) ? value.join(", ") || "(none)" : String(value);

function tally(question: ReviewQuestion, answers: ReviewAnswer[]): string {
	if (answers.length === 0) return "no answers";
	switch (question.type) {
		case "label":
		case "multi_label": {
			const counts = new Map(question.options.map((option) => [option.value, 0]));
			for (const answer of answers) {
				for (const value of Array.isArray(answer) ? answer : [answer]) {
					counts.set(String(value), (counts.get(String(value)) ?? 0) + 1);
				}
			}
			return [...counts].map(([value, count]) => `${value} ${count}`).join(", ");
		}
		case "rating": {
			const values = answers as number[];
			const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
			const counts = new Map<number, number>();
			for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
			const spread = [...counts]
				.sort(([a], [b]) => a - b)
				.map(([v, c]) => `${v}: ${c}`)
				.join(", ");
			return `mean ${mean.toFixed(2)} (${spread})`;
		}
		case "boolean": {
			const yes = answers.filter((a) => a === true).length;
			return `true ${yes}, false ${answers.length - yes}`;
		}
		case "text":
			return `${answers.length} written`;
	}
}

const clip = (text: string, max: number) =>
	text.length > max ? `${text.slice(0, max - 1)}…` : text;

const flat = (text: string) => text.replace(/\s+/g, " ").trim();

/** m:ss under an hour, h:mm:ss past it */
export function clockText(seconds: number): string {
	const whole = Math.floor(seconds);
	const s = String(whole % 60).padStart(2, "0");
	const m = Math.floor(whole / 60) % 60;
	const h = Math.floor(whole / 3600);
	return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

/** how a comment points into its field, the pane prints the same */
export function anchorText(comment: Pick<ReviewComment, "quote" | "area" | "time">): string {
	if (comment.quote) return ` "${clip(flat(comment.quote.exact), QUOTE_CHARS)}"`;
	const parts: string[] = [];
	if (comment.time) {
		const { start, end } = comment.time;
		parts.push(end === undefined ? clockText(start) : `${clockText(start)}-${clockText(end)}`);
	}
	if (comment.area) {
		const { x, y, w, h } = comment.area;
		parts.push(`area ${percent(x)},${percent(y)} ${percent(w)}x${percent(h)}`);
	}
	return parts.length ? ` [${parts.join(" ")}]` : "";
}

export function reviewSlug(title: string): string {
	const slug = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60)
		.replace(/-+$/, "");
	return slug || "review";
}

export function responseLines(review: MlReview): string[] {
	return review.records.map((record, index) => {
		const draft = draftAt(review, index);
		const suggested = Object.fromEntries(
			Object.entries(record.suggestions ?? {}).map(([name, s]) => [name, s.value])
		);
		return JSON.stringify({
			id: record.id,
			status: recordStatus(review.schema, draft),
			answers: Object.fromEntries(
				Object.entries(draft?.answers ?? {}).filter(([, value]) => isAnswered(value))
			),
			suggested,
			comments: (draft?.comments ?? []).map((comment) => ({
				...(comment.field ? { field: comment.field } : {}),
				...(comment.quote ? { quote: comment.quote.exact } : {}),
				...(comment.area ? { area: comment.area } : {}),
				...(comment.time ? { time: comment.time } : {}),
				body: comment.body,
			})),
			schema: review.schemaHash,
		});
	});
}

/** split so no part outgrows a virtual file version */
export function responseParts(lines: string[], maxBytes = ML_FILE_MAX_BYTES): string[] {
	const whole = lines.map((line) => `${line}\n`).join("");
	if (Buffer.byteLength(whole, "utf8") <= maxBytes) return [whole];
	const parts: string[] = [];
	let current = "";
	let bytes = 0;
	for (const line of lines) {
		const size = Buffer.byteLength(line, "utf8") + 1;
		if (current && bytes + size > maxBytes) {
			parts.push(current);
			current = "";
			bytes = 0;
		}
		current += `${line}\n`;
		bytes += size;
	}
	if (current) parts.push(current);
	return parts;
}

const count = (n: number) => n.toLocaleString("en-US");

const READ_FROM: Record<ReviewDatasetVia, string> = {
	viewer: "through the dataset viewer",
	parquet: "from its Parquet files",
	converted: "from the viewer's Parquet conversion",
	jsonl: "from its JSONL files by range reads",
	csv: "from its CSV files by range reads",
	tsv: "from its TSV files by range reads",
};

/** names the path and revision read, so a next batch can match it */
export function sourceLine(source: ReviewSource): string | undefined {
	if (source.kind !== "dataset" && source.kind !== "parquet") return undefined;
	const { sample } = source;
	const at = source.revision
		? ` at ${/^[0-9a-f]{40}$/.test(source.revision) ? source.revision.slice(0, 8) : source.revision}`
		: "";
	const from =
		source.kind === "dataset"
			? `${source.repo} ${source.config}/${source.split}, read ${READ_FROM[source.via]}${at}${source.partial ? " (it covers only the first part of this split)" : ""}`
			: `${source.uri}${source.files.length > 1 ? ` (${source.files.length} files)` : ""}${at}`;
	const of =
		sample.total !== undefined
			? `${count(sample.rows)} of ${count(sample.total)} rows`
			: `${count(sample.rows)} rows${sample.bytes !== undefined ? ` of ${(sample.bytes / 1024 / 1024).toFixed(1)} MB` : ""}`;
	const drawn =
		sample.method === "head"
			? `rows ${count(sample.offset ?? 0)}-${count((sample.offset ?? 0) + sample.rows - 1)}`
			: sample.approximate
				? `an approximate random sample, seed ${sample.seed}, lines picked at random byte offsets (biased toward lines after long ones)`
				: sample.groups !== undefined
					? `a random sample grouped inside ${sample.groups} random row group${sample.groups === 1 ? "" : "s"}, seed ${sample.seed}`
					: `a random sample, seed ${sample.seed}, in ${sample.windows} window${sample.windows === 1 ? "" : "s"}`;
	const filter = sample.where
		? ` where ${sample.where}`
		: sample.query
			? ` matching "${sample.query}"`
			: "";
	const fellBack =
		source.kind === "dataset" && source.viewerError
			? ` The dataset viewer was not used: ${source.viewerError}.`
			: "";
	return `Source: ${of} of ${from}${filter}, ${drawn}.${fellBack}`;
}

export function pushLine(
	destination: NonNullable<MlReview["destination"]>,
	push: ReviewPush | undefined
): string {
	const where = `${destination.repo} (${push?.path ?? destination.path})`;
	if (push?.status === "pushed") {
		return push.pr
			? `Labels pushed as a pull request on ${where}: ${push.url}`
			: `Labels pushed to ${where}: ${push.url}`;
	}
	if (push?.status === "failed") {
		return `Labels were NOT pushed to ${where}: ${push.error}. The answers are in the file below.`;
	}
	return `Labels are still being pushed to ${where}; check ${destinationUrl(destination)}.`;
}

export function reviewResultText(
	review: MlReview,
	submission: { note?: string },
	files: MlFileRef[],
	push?: ReviewPush
): string {
	const counts = reviewCounts(review);
	const source = sourceLine(review.source);
	const lines: string[] = [
		`Review "${review.schema.title}" submitted (schema ${review.schemaHash}).`,
		...(source ? [source] : []),
		...(submission.note ? [`Note from the user: "${submission.note}"`] : []),
		review.schema.questions.length > 0
			? `Records: ${counts.answered} answered, ${counts.skipped} skipped, ${counts.discarded} discarded, ${counts.pending} not finished (of ${counts.total}).`
			: `Records: ${counts.answered} marked OK, ${counts.discarded} rejected, ${counts.skipped} skipped, ${counts.pending} not finished (of ${counts.total}).`,
	];
	const answeredAny = Object.values(review.drafts).some((draft) =>
		Object.values(draft?.answers ?? {}).some(isAnswered)
	);
	const annotated =
		counts.answered + counts.discarded + counts.comments > 0 || answeredAny || submission.note;
	if (!annotated) lines.push("The user looked at the records and left no annotations.");
	// with no questions the status is the whole answer, a pane stores ok as answered
	if (review.schema.questions.length === 0 && review.records.length <= REVIEW_INLINE_ANSWERS) {
		const idsWith = (status: ReviewDraft["status"]) =>
			review.records
				.filter((_, index) => recordStatus(review.schema, draftAt(review, index)) === status)
				.map((r) => r.id);
		const marked = idsWith("answered");
		const rejected = idsWith("discarded");
		if (marked.length) lines.push(`Marked OK: ${marked.join(", ")}`);
		if (rejected.length) lines.push(`Rejected: ${rejected.join(", ")}`);
	}

	for (const question of review.schema.questions) {
		const answers: ReviewAnswer[] = [];
		let compared = 0;
		let matched = 0;
		review.records.forEach((record, index) => {
			const value = draftAt(review, index)?.answers?.[question.name];
			if (!isAnswered(value)) return;
			answers.push(value as ReviewAnswer);
			const suggestion = record.suggestions?.[question.name];
			if (suggestion) {
				compared += 1;
				if (sameAnswer(suggestion.value, value as ReviewAnswer)) matched += 1;
			}
		});
		const agreement = compared > 0 ? ` Your suggestion matched on ${matched} of ${compared}.` : "";
		lines.push(`${question.name}: ${tally(question, answers)}.${agreement}`);
	}

	const comments: string[] = [];
	review.records.forEach((record, index) => {
		for (const comment of draftAt(review, index)?.comments ?? []) {
			const where = comment.field ?? "record";
			comments.push(`- ${record.id} ${where}${anchorText(comment)}: ${comment.body}`);
		}
	});

	const answers: string[] = [];
	if (review.records.length <= REVIEW_INLINE_ANSWERS && review.schema.questions.length > 0) {
		review.records.forEach((record, index) => {
			const draft = draftAt(review, index);
			const given = review.schema.questions
				.map((question) => {
					const value = draft?.answers?.[question.name];
					return isAnswered(value)
						? `${question.name}=${showAnswer(value as ReviewAnswer)}`
						: undefined;
				})
				.filter(Boolean);
			answers.push(
				`- ${record.id} (${recordStatus(review.schema, draft)})${given.length ? `: ${given.join("; ")}` : ""}`
			);
		});
	}

	let budget = REVIEW_RESULT_BUDGET_CHARS;
	const fits = (line: string) => {
		if (line.length + 1 > budget) return false;
		budget -= line.length + 1;
		return true;
	};
	if (counts.pending > 0) {
		const ids = review.records
			.filter((_, index) => recordStatus(review.schema, draftAt(review, index)) === "pending")
			.map((record) => record.id);
		const listed = `${counts.pending} of ${counts.total} records not finished: ${ids.join(", ")}`;
		lines.push(
			fits(listed)
				? listed
				: `${counts.pending} of ${counts.total} records not finished, their ids are the rows with status "pending" in the responses file`,
			"Those records are missing labels. Do not treat them as labelled, for example in a golden or eval set or a training split."
		);
	}

	// comments are the feedback so they come before inline answers, whatever is cut stays in the responses file
	const shown: string[] = [];
	for (const line of comments) {
		if (!fits(line)) break;
		shown.push(line);
	}
	lines.push(`Comments (${comments.length}):`, ...(comments.length ? shown : ["(none)"]));
	if (shown.length < comments.length) {
		lines.push(`- ${comments.length - shown.length} more comments are in the responses file`);
	}
	if (answers.length) {
		if (answers.reduce((sum, line) => sum + line.length + 1, 0) <= budget) {
			lines.push("Answers:", ...answers);
		} else {
			lines.push("Answers: too long to repeat here, they are in the responses file");
		}
	}

	if (review.destination) lines.push(pushLine(review.destination, push));
	else if (review.declinedDestination) {
		const { repo, path } = review.declinedDestination;
		lines.push(
			`Labels were NOT pushed to ${repo} (${path}): the user submitted without confirming the push. Do not push them unless the user asks.`
		);
	}
	lines.push(
		files.length === 1
			? `All answers: ${formatVirtualFileRef(files[0].name)} (version ${files[0].version})`
			: `All answers, in ${files.length} parts: ${files
					.map((file) => `${formatVirtualFileRef(file.name)} (version ${file.version})`)
					.join(", ")}`
	);
	lines.push(REVIEW_NEXT_STEPS);
	return lines.join("\n");
}

/** tags the files a submission wrote, so a rebuild after a crash reuses them */
export const reviewFileSource = (review: Pick<MlReview, "_id">) =>
	`review:${review._id.toString()}`;

/** found again by their source tag on a repeat */
export async function ensureReviewFiles(review: MlReview): Promise<MlFileRef[]> {
	if (review.result) return review.result.files;
	const parts = responseParts(responseLines(review));
	const base = `reviews/${reviewSlug(review.schema.title)}.responses`;
	const source = reviewFileSource(review);
	const files: MlFileRef[] = [];
	for (const [index, content] of parts.entries()) {
		const name = parts.length === 1 ? `${base}.jsonl` : `${base}.part-${index + 1}.jsonl`;
		const existing = await collections.mlFiles.findOne(
			{ conversationId: review.conversationId, name, source },
			{ projection: { version: 1 } }
		);
		if (existing) {
			files.push({ name, version: existing.version });
			continue;
		}
		const written = await writeMlFileVersion({
			conversationId: review.conversationId,
			name,
			content,
			origin: "review",
			source,
			summary: `answers to review "${review.schema.title}" (schema ${review.schemaHash})`,
			attribution: { messageId: review.messageId, toolUuid: review.toolUuid },
		});
		files.push({ name: written.name, version: written.version });
	}
	return files;
}

/** with a destination it pushes first, so it runs in the resume or the delivery and never the submit */
export async function ensureReviewResult(
	review: MlReview,
	/** absent reads the owner last session, a resume or sweep has no request */
	token?: string
): Promise<NonNullable<MlReview["result"]>> {
	if (review.result) return review.result;
	const submission = { note: review.note ?? review.summary };
	const files = await ensureReviewFiles(review);
	const push = await pushReviewLabels(review, token);
	return storeReviewResult(review, {
		text: reviewResultText(review, submission, files, push),
		files,
		...(push?.status === "pushed" && push.url && push.path
			? { pushed: { url: push.url, pr: push.pr === true, path: push.path } }
			: {}),
	});
}
