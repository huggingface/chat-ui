import type {
	ReviewField,
	ReviewRecord,
	ReviewSchema,
	ReviewSuggestion,
} from "$lib/types/MlReview";
import { validateAnswer } from "./answers";
import { SUGGESTIONS_KEY } from "./schema";

const MAX_ERRORS = 10;
const MAX_RATIONALE_CHARS = 1_000;
const MAX_ID_CHARS = 200;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

type FieldCheck = (value: unknown) => string | undefined;

function checkFor(field: ReviewField): FieldCheck {
	switch (field.type) {
		case "text":
		case "markdown":
		case "code":
		case "category":
			return (value) =>
				typeof value === "string"
					? undefined
					: typeof value === "object"
						? "must be a string; declare the field as json to show a list or an object"
						: "must be a string";
		case "number":
			return (value) =>
				typeof value === "number" && Number.isFinite(value) ? undefined : "must be a number";
		case "json":
			return () => undefined;
		case "image":
			return (value) =>
				typeof value === "string" && /^(https:\/\/|hf:\/\/)\S+$/.test(value)
					? undefined
					: "must be an https:// or hf:// URL";
		case "chat":
			return (value) =>
				Array.isArray(value) &&
				value.every(
					(turn) =>
						isRecord(turn) && typeof turn.role === "string" && typeof turn.content === "string"
				)
					? undefined
					: "must be a list of {role, content} turns";
	}
}

export type ValidatedRecords =
	{ ok: true; records: ReviewRecord[] } | { ok: false; errors: string[] };

/** a null or absent field shows empty, so a sparse dataset row is not refused */
export function compileRecordValidator(
	schema: Pick<ReviewSchema, "idField" | "fields" | "questions">
) {
	const checks = new Map(schema.fields.map((field) => [field.name, checkFor(field)]));
	const questions = new Map(schema.questions.map((question) => [question.name, question]));
	const known = new Set([schema.idField, SUGGESTIONS_KEY, ...checks.keys()]);

	return function validateRecords(raw: unknown[]): ValidatedRecords {
		const errors: string[] = [];
		const records: ReviewRecord[] = [];
		const seen = new Map<string, number>();
		const fail = (position: number, message: string) => {
			if (errors.length < MAX_ERRORS) errors.push(`record ${position}: ${message}`);
		};

		for (const [index, item] of raw.entries()) {
			const position = index + 1;
			if (!isRecord(item)) {
				fail(position, "must be an object");
				continue;
			}
			const before = errors.length;
			const rawId = item[schema.idField];
			let id: string | undefined;
			if (typeof rawId === "string" && rawId.trim().length > 0) id = rawId.trim();
			else if (typeof rawId === "number" && Number.isFinite(rawId)) id = String(rawId);
			if (id === undefined) {
				fail(position, `${schema.idField} is missing; every record needs a string or number id`);
			} else if (id.length > MAX_ID_CHARS) {
				fail(position, `${schema.idField} is over ${MAX_ID_CHARS} characters`);
			} else if (seen.has(id)) {
				fail(position, `${schema.idField} "${id}" repeats record ${seen.get(id)}`);
			} else {
				seen.set(id, position);
			}

			const unknown = Object.keys(item).filter((key) => !known.has(key));
			if (unknown.length > 0) {
				fail(
					position,
					`unknown key${unknown.length > 1 ? "s" : ""} ${unknown.map((k) => `"${k}"`).join(", ")}; declare ${
						unknown.length > 1 ? "them" : "it"
					} as a field or drop ${unknown.length > 1 ? "them" : "it"}`
				);
			}

			const values: Record<string, unknown> = {};
			for (const [name, check] of checks) {
				const value = item[name];
				if (value === undefined || value === null) continue;
				const problem = check(value);
				if (problem) fail(position, `${name} ${problem}`);
				else values[name] = value;
			}

			let suggestions: Record<string, ReviewSuggestion> | undefined;
			const rawSuggestions = item[SUGGESTIONS_KEY];
			if (rawSuggestions !== undefined) {
				if (!isRecord(rawSuggestions)) {
					fail(position, `${SUGGESTIONS_KEY} must be an object keyed by question name`);
				} else {
					suggestions = {};
					for (const [questionName, rawSuggestion] of Object.entries(rawSuggestions)) {
						const question = questions.get(questionName);
						const at = `${SUGGESTIONS_KEY}.${questionName}`;
						if (!question) {
							fail(position, `${at} names no declared question`);
							continue;
						}
						if (!isRecord(rawSuggestion) || !("value" in rawSuggestion)) {
							fail(position, `${at} must be {value, score?, rationale?}`);
							continue;
						}
						const problem = validateAnswer(question, rawSuggestion.value);
						if (problem) {
							fail(position, `${at}.value ${problem}`);
							continue;
						}
						const { score, rationale } = rawSuggestion;
						if (
							score !== undefined &&
							(typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1)
						) {
							fail(position, `${at}.score must be a number from 0 to 1`);
							continue;
						}
						if (
							rationale !== undefined &&
							(typeof rationale !== "string" || rationale.length > MAX_RATIONALE_CHARS)
						) {
							fail(
								position,
								`${at}.rationale must be text of at most ${MAX_RATIONALE_CHARS} characters`
							);
							continue;
						}
						suggestions[questionName] = {
							value: rawSuggestion.value as ReviewSuggestion["value"],
							...(score !== undefined ? { score } : {}),
							...(rationale !== undefined ? { rationale } : {}),
						};
					}
				}
			}

			if (errors.length === before && id !== undefined) {
				records.push({
					id,
					values,
					...(suggestions && Object.keys(suggestions).length > 0 ? { suggestions } : {}),
				});
			}
		}

		if (errors.length > 0) return { ok: false, errors };
		return { ok: true, records };
	};
}
