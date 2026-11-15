import type {
	ReviewDraft,
	ReviewField,
	ReviewQuestion,
	ReviewRecord,
	ReviewSchema,
} from "$lib/types/MlReview";
import { isAnswered } from "./answers";

export type RecordState = "answered" | "skipped" | "todo";

export function recordState(draft: Pick<ReviewDraft, "status"> | undefined): RecordState {
	if (draft?.status === "answered") return "answered";
	if (draft?.status === "skipped" || draft?.status === "discarded") return "skipped";
	return "todo";
}

export interface ProgressRun<T extends string> {
	state: T;
	count: number;
}

/** neighbours in the same state merge, so 500 records draw as a handful of runs */
export function progressRuns<T extends string>(states: readonly T[]): ProgressRun<T>[] {
	const runs: ProgressRun<T>[] = [];
	for (const state of states) {
		const last = runs.at(-1);
		if (last && last.state === state) last.count += 1;
		else runs.push({ state, count: 1 });
	}
	return runs;
}

/** the fields worth showing, the id already sits in the record nav */
export const shownFields = (schema: Pick<ReviewSchema, "fields" | "idField">): ReviewField[] =>
	schema.fields.filter((field) => field.name !== schema.idField);

const HEADING_CHARS = 160;
const HEADING_SAMPLE = 20;

/** the first text field short enough to read as a title across the first records */
export function headingField(
	schema: Pick<ReviewSchema, "fields" | "idField">,
	records: readonly ReviewRecord[]
): ReviewField | undefined {
	const sample = records.slice(0, HEADING_SAMPLE);
	return shownFields(schema).find(
		(field) =>
			field.type === "text" &&
			sample.some((record) => typeof record.values[field.name] === "string") &&
			sample.every((record) => {
				const value = record.values[field.name];
				return value === undefined || value === null || String(value).length <= HEADING_CHARS;
			})
	);
}

/** markdown and JSON as one line of plain words, for previews */
export function plainText(value: unknown): string {
	if (value === undefined || value === null) return "";
	if (typeof value !== "string") {
		if (Array.isArray(value) && value.every((turn) => turn && typeof turn === "object")) {
			return value
				.map((turn) => String((turn as { content?: unknown }).content ?? ""))
				.join(" ")
				.replace(/\s+/g, " ")
				.trim();
		}
		return JSON.stringify(value);
	}
	return value
		.replace(/```[^\n]*\n?/g, " ")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/<[^>]+>/g, " ")
		.replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
		.replace(/(\*\*|__|`|~~)/g, "")
		.replace(/(^|[\s(])[*_](\S(?:[^*_]*\S)?)[*_](?=[\s).,;:!?]|$)/g, "$1$2")
		.replace(/\s+/g, " ")
		.trim();
}

const sameAnswer = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** a question the user answered differently from the model guess */
export function modelDisagrees(
	schema: Pick<ReviewSchema, "questions">,
	record: ReviewRecord,
	draft: ReviewDraft | undefined
): boolean {
	return schema.questions.some((question) => {
		const guess = record.suggestions?.[question.name];
		const answer = draft?.answers[question.name];
		return guess !== undefined && isAnswered(answer) && !sameAnswer(guess.value, answer);
	});
}

export function modelAgrees(
	question: ReviewQuestion,
	record: ReviewRecord,
	answer: unknown
): boolean | undefined {
	const guess = record.suggestions?.[question.name];
	if (guess === undefined || !isAnswered(answer)) return undefined;
	return sameAnswer(guess.value, answer);
}

const TABLE_TYPES = new Set(["text", "number", "category"]);

/** rows that read well as a grid, short typed values, no prose or media */
export function isTabular(
	schema: Pick<ReviewSchema, "fields" | "idField">,
	records: readonly ReviewRecord[]
): boolean {
	const fields = shownFields(schema);
	if (fields.length < 2 || !fields.every((field) => TABLE_TYPES.has(field.type))) return false;
	return records
		.slice(0, HEADING_SAMPLE)
		.every((record) =>
			fields.every((field) => String(record.values[field.name] ?? "").length <= 280)
		);
}

/** the image a record is about, when the image comes first */
export function leadImageField(
	schema: Pick<ReviewSchema, "fields" | "idField">
): ReviewField | undefined {
	const first = shownFields(schema)[0];
	return first?.type === "image" ? first : undefined;
}

/** the first yes/no question, which colours the bar pass and fail */
export const passFailQuestion = (
	schema: Pick<ReviewSchema, "questions">
): Extract<ReviewQuestion, { type: "boolean" }> | undefined =>
	schema.questions.find(
		(question): question is Extract<ReviewQuestion, { type: "boolean" }> =>
			question.type === "boolean"
	);

export type RecordDecision = "approved" | "rejected";

/** a review with no questions, or with a yes/no one, lets the user approve or reject records */
export const canDecide = (schema: Pick<ReviewSchema, "questions">): boolean =>
	schema.questions.length === 0 || passFailQuestion(schema) !== undefined;

/** the yes/no question carries the decision when there is one, otherwise the record status does */
export function recordDecision(
	schema: Pick<ReviewSchema, "questions">,
	draft: Pick<ReviewDraft, "status" | "answers"> | undefined
): RecordDecision | undefined {
	if (schema.questions.length === 0) {
		if (draft?.status === "answered") return "approved";
		if (draft?.status === "discarded") return "rejected";
		return undefined;
	}
	const question = passFailQuestion(schema);
	const value = question ? draft?.answers[question.name] : undefined;
	return value === true ? "approved" : value === false ? "rejected" : undefined;
}

/** answered or rejected, a submit with none of these is refused */
export const isDecided = (draft: Pick<ReviewDraft, "status"> | undefined): boolean =>
	draft?.status === "answered" || draft?.status === "discarded";

export function questionSummary(question: ReviewQuestion): string {
	switch (question.type) {
		case "label":
			return question.options.map((option) => option.title ?? option.value).join(", ");
		case "multi_label":
			return `any of ${question.options.map((option) => option.title ?? option.value).join(", ")}`;
		case "rating":
			return `rating ${question.min} to ${question.max}`;
		case "boolean":
			return "yes or no";
		case "text":
			return "free text";
	}
}

/** the number keys a question answers to, a text question has none */
export function keyRange(question: ReviewQuestion): string | undefined {
	const count =
		question.type === "label" || question.type === "multi_label"
			? question.options.length
			: question.type === "rating"
				? question.max - question.min + 1
				: question.type === "boolean"
					? 2
					: 0;
	if (count === 0) return undefined;
	return `1–${Math.min(count, 9)}`;
}
