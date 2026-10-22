import type {
	ReviewDraft,
	ReviewDraftStatus,
	ReviewQuestion,
	ReviewSchema,
} from "$lib/types/MlReview";

const optionValues = (question: { options: { value: string }[] }) =>
	question.options.map((option) => option.value);

export function validateAnswer(question: ReviewQuestion, value: unknown): string | undefined {
	switch (question.type) {
		case "label":
			if (typeof value !== "string") return "must be one option value";
			return optionValues(question).includes(value)
				? undefined
				: `"${value}" is not an option (${optionValues(question).join(", ")})`;
		case "multi_label": {
			if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
				return "must be a list of option values";
			}
			const allowed = optionValues(question);
			const unknown = value.find((v) => !allowed.includes(v as string));
			if (unknown !== undefined) return `"${unknown}" is not an option (${allowed.join(", ")})`;
			if (new Set(value).size !== value.length) return "lists an option twice";
			if (question.min !== undefined && value.length < question.min) {
				return `pick at least ${question.min}`;
			}
			if (question.max !== undefined && value.length > question.max) {
				return `pick at most ${question.max}`;
			}
			return undefined;
		}
		case "rating":
			if (typeof value !== "number" || !Number.isInteger(value)) return "must be a whole number";
			return value < question.min || value > question.max
				? `must be between ${question.min} and ${question.max}`
				: undefined;
		case "boolean":
			return typeof value === "boolean" ? undefined : "must be true or false";
		case "text":
			if (typeof value !== "string") return "must be text";
			return value.length > question.maxLength
				? `is ${value.length} characters, over ${question.maxLength}`
				: undefined;
	}
}

/** an empty text or an empty pick is no answer, so a required question stays open on it */
export function isAnswered(value: unknown): boolean {
	if (value === undefined || value === null) return false;
	if (typeof value === "string") return value.trim().length > 0;
	if (Array.isArray(value)) return value.length > 0;
	return true;
}

export interface ReviewBlocker {
	/** record position, 0 based */
	record: number;
	question: string;
	reason: string;
}

export function blockers(
	schema: Pick<ReviewSchema, "questions">,
	drafts: Record<string, ReviewDraft | undefined>,
	recordCount: number
): ReviewBlocker[] {
	const found: ReviewBlocker[] = [];
	for (let record = 0; record < recordCount; record += 1) {
		const draft = drafts[String(record)];
		const settled = draft?.status === "skipped" || draft?.status === "discarded";
		for (const question of schema.questions) {
			const value = draft?.answers?.[question.name];
			if (!isAnswered(value)) {
				if (question.required && !settled) {
					found.push({ record, question: question.name, reason: "required" });
				}
				continue;
			}
			const problem = validateAnswer(question, value);
			if (problem) found.push({ record, question: question.name, reason: problem });
		}
	}
	return found;
}

/** a submit may leave records unfinished, so only an answer that is there and wrong refuses it */
export const invalidAnswers = (...args: Parameters<typeof blockers>): ReviewBlocker[] =>
	blockers(...args).filter((found) => found.reason !== "required");

/** an answered record missing a required answer is not finished, whatever status was stored */
export function recordStatus(
	schema: Pick<ReviewSchema, "questions">,
	draft: ReviewDraft | undefined
): ReviewDraftStatus {
	const status = draft?.status ?? "pending";
	if (status !== "answered") return status;
	const missing = schema.questions.some(
		(question) => question.required && !isAnswered(draft?.answers?.[question.name])
	);
	return missing ? "pending" : status;
}
