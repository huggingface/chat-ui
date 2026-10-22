import { z } from "zod";
import type { ReviewSchema } from "$lib/types/MlReview";

export const REVIEW_LIMITS = {
	fields: 30,
	questions: 20,
	minOptions: 2,
	maxOptions: 20,
	ratingSteps: 11,
	textChars: 4_000,
	titleChars: 200,
	instructionsChars: 4_000,
	optionChars: 200,
	descriptionChars: 1_000,
	idFieldChars: 64,
	comments: 200,
	commentsPerRecord: 20,
	commentChars: 2_000,
} as const;

export const REVIEW_NAME_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

export const REVIEW_FIELD_TYPES = [
	"text",
	"markdown",
	"code",
	"json",
	"chat",
	"image",
	"audio",
	"video",
	"number",
	"category",
] as const;

export const REVIEW_QUESTION_TYPES = ["label", "multi_label", "rating", "boolean", "text"] as const;

export const REVIEW_SUGGESTION_MODES = ["shown", "after_answer", "none"] as const;

/** a record carries its model guesses under this key, so no field may take the name */
export const SUGGESTIONS_KEY = "suggestions";

const name = z
	.string()
	.regex(
		REVIEW_NAME_PATTERN,
		"names are lowercase snake_case, start with a letter and are at most 40 characters"
	)
	.refine((value) => value !== SUGGESTIONS_KEY, `"${SUGGESTIONS_KEY}" is reserved`);

const shortText = (max: number) => z.string().trim().min(1).max(max, `at most ${max} characters`);

const field = z.object({
	name,
	type: z.enum(REVIEW_FIELD_TYPES),
	title: shortText(REVIEW_LIMITS.titleChars).optional(),
	language: z.string().trim().max(40).optional(),
});

const option = z.object({
	value: shortText(REVIEW_LIMITS.optionChars),
	title: shortText(REVIEW_LIMITS.optionChars).optional(),
	description: shortText(REVIEW_LIMITS.descriptionChars).optional(),
});

const options = z
	.array(option)
	.min(
		REVIEW_LIMITS.minOptions,
		`give ${REVIEW_LIMITS.minOptions} to ${REVIEW_LIMITS.maxOptions} options`
	)
	.max(
		REVIEW_LIMITS.maxOptions,
		`give ${REVIEW_LIMITS.minOptions} to ${REVIEW_LIMITS.maxOptions} options`
	);

const questionBase = {
	name,
	title: shortText(REVIEW_LIMITS.titleChars).optional(),
	description: shortText(REVIEW_LIMITS.descriptionChars).optional(),
	required: z.boolean().optional(),
	target: z.string().optional(),
};

const count = z.number().int().nonnegative();

const question = z.discriminatedUnion("type", [
	z.object({ ...questionBase, type: z.literal("label"), options }),
	z.object({
		...questionBase,
		type: z.literal("multi_label"),
		options,
		min: count.optional(),
		max: count.optional(),
	}),
	z.object({
		...questionBase,
		type: z.literal("rating"),
		min: z.number().int().optional(),
		max: z.number().int().optional(),
	}),
	z.object({ ...questionBase, type: z.literal("boolean") }),
	z.object({
		...questionBase,
		type: z.literal("text"),
		max_length: z.number().int().positive().max(REVIEW_LIMITS.textChars).optional(),
	}),
]);

export const reviewDeclarationSchema = z.object({
	title: shortText(REVIEW_LIMITS.titleChars),
	instructions: shortText(REVIEW_LIMITS.instructionsChars).optional(),
	id_field: z
		.string()
		.trim()
		.min(1)
		.max(REVIEW_LIMITS.idFieldChars)
		.refine((value) => value !== SUGGESTIONS_KEY, `"${SUGGESTIONS_KEY}" is reserved`)
		.optional(),
	fields: z
		.array(field)
		.min(1, "declare at least one field")
		.max(REVIEW_LIMITS.fields, `at most ${REVIEW_LIMITS.fields} fields`),
	questions: z
		.array(question)
		.max(REVIEW_LIMITS.questions, `at most ${REVIEW_LIMITS.questions} questions`)
		.optional(),
	suggestions: z.enum(REVIEW_SUGGESTION_MODES).optional(),
});

export type ReviewDeclaration = z.input<typeof reviewDeclarationSchema>;

export type ParsedReviewSchema = { ok: true; schema: ReviewSchema } | { ok: false; error: string };

function issueText(error: z.ZodError): string {
	const issue = error.issues[0];
	const path = issue?.path
		.map((part, i) => (typeof part === "number" ? `[${part}]` : i === 0 ? part : `.${part}`))
		.join("");
	return `${path ? `${path}: ` : ""}${issue?.message ?? "invalid"}`;
}

const DEFAULT_RATING = { min: 1, max: 5 };

export function parseReviewSchema(input: unknown): ParsedReviewSchema {
	const parsed = reviewDeclarationSchema.safeParse(input);
	if (!parsed.success) return { ok: false, error: issueText(parsed.error) };
	const declared = parsed.data;

	const fieldNames = new Set<string>();
	for (const [i, f] of declared.fields.entries()) {
		if (fieldNames.has(f.name)) {
			return { ok: false, error: `fields[${i}].name: "${f.name}" is declared twice` };
		}
		fieldNames.add(f.name);
	}

	const questions: ReviewSchema["questions"] = [];
	const questionNames = new Set<string>();
	for (const [i, q] of (declared.questions ?? []).entries()) {
		const at = `questions[${i}]`;
		if (questionNames.has(q.name)) {
			return { ok: false, error: `${at}.name: "${q.name}" is declared twice` };
		}
		questionNames.add(q.name);
		if (q.target !== undefined && !fieldNames.has(q.target)) {
			return {
				ok: false,
				error: `${at}.target: "${q.target}" is not a declared field (fields: ${[...fieldNames].join(", ")})`,
			};
		}
		const base = {
			name: q.name,
			required: q.required === true,
			...(q.title ? { title: q.title } : {}),
			...(q.description ? { description: q.description } : {}),
			...(q.target !== undefined ? { target: q.target } : {}),
		};
		if (q.type === "label" || q.type === "multi_label") {
			const values = new Set<string>();
			for (const [j, o] of q.options.entries()) {
				if (values.has(o.value)) {
					return { ok: false, error: `${at}.options[${j}].value: "${o.value}" is listed twice` };
				}
				values.add(o.value);
			}
		}
		switch (q.type) {
			case "label":
				questions.push({ ...base, type: "label", options: q.options });
				break;
			case "multi_label": {
				const min = q.min;
				const max = q.max;
				if (max !== undefined && (max < 1 || max > q.options.length)) {
					return { ok: false, error: `${at}.max: must be between 1 and ${q.options.length}` };
				}
				if (min !== undefined && min > (max ?? q.options.length)) {
					return { ok: false, error: `${at}.min: must not exceed max` };
				}
				questions.push({
					...base,
					type: "multi_label",
					options: q.options,
					...(min !== undefined ? { min } : {}),
					...(max !== undefined ? { max } : {}),
				});
				break;
			}
			case "rating": {
				const min = q.min ?? DEFAULT_RATING.min;
				const max = q.max ?? (q.min !== undefined ? q.min + 4 : DEFAULT_RATING.max);
				if (max <= min) return { ok: false, error: `${at}: max must be greater than min` };
				if (max - min + 1 > REVIEW_LIMITS.ratingSteps) {
					return {
						ok: false,
						error: `${at}: a rating has at most ${REVIEW_LIMITS.ratingSteps} steps, ${min} to ${max} is ${max - min + 1}`,
					};
				}
				questions.push({ ...base, type: "rating", min, max });
				break;
			}
			case "boolean":
				questions.push({ ...base, type: "boolean" });
				break;
			case "text":
				questions.push({
					...base,
					type: "text",
					maxLength: q.max_length ?? REVIEW_LIMITS.textChars,
				});
				break;
		}
	}

	return {
		ok: true,
		schema: {
			title: declared.title,
			...(declared.instructions ? { instructions: declared.instructions } : {}),
			idField: declared.id_field ?? "id",
			fields: declared.fields.map((f) => ({
				name: f.name,
				type: f.type,
				...(f.title ? { title: f.title } : {}),
				...(f.type === "code" && f.language ? { language: f.language } : {}),
			})) as ReviewSchema["fields"],
			questions,
			suggestions: declared.suggestions ?? "shown",
		},
	};
}
