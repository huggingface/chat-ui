import type { OpenAiTool } from "$lib/server/mcp/tools";
import {
	REVIEW_FIELD_TYPES,
	REVIEW_LIMITS,
	REVIEW_QUESTION_TYPES,
	REVIEW_SUGGESTION_MODES,
} from "$lib/utils/review/schema";

export const REQUEST_REVIEW_TOOL_NAME = "request_review";

export const REVIEW_MAX_RECORDS = 500;
export const REVIEW_MAX_BYTES = 4 * 1024 * 1024;
export const REVIEW_MAX_INLINE_RECORDS = 20;
export const REVIEW_MAX_INLINE_CHARS = 16_000;

/** re-sent every round while offered, held to 600 characters by the prompt spec */
export const REQUEST_REVIEW_PREPROMPT =
	`SHOWING DATA: when the user asks to see data, show it with ${REQUEST_REVIEW_TOOL_NAME}, and before you train or push. ` +
	`Golden and eval sets use suggestions "after_answer". ` +
	`Over ${REVIEW_MAX_INLINE_RECORDS} records go in a file. One review per round. ` +
	"Sample a Hub dataset with source.dataset, not a job, unless the rows need preprocessing. " +
	`Never wait for the dataset viewer, ${REQUEST_REVIEW_TOOL_NAME} falls back on its own. ` +
	`After revising data for review comments, call ${REQUEST_REVIEW_TOOL_NAME} again.`;

const SAMPLE_PROPERTIES = {
	sample: {
		type: "string",
		enum: ["head", "random"],
		description: '"head" (default) takes rows in order, "random" a seeded sample across all rows.',
	},
	rows: {
		type: "integer",
		description: `How many rows, default 50, at most ${REVIEW_MAX_RECORDS}.`,
	},
	offset: { type: "integer", description: "head: the first row." },
	seed: { type: "integer", description: "random: repeat a sample, the result gives its seed." },
} as const;

/** kept apart from the tool so the prompt specs can measure it without a database */
export const requestReviewDefinition: OpenAiTool = {
	type: "function",
	function: {
		name: REQUEST_REVIEW_TOOL_NAME,
		description:
			"Show records to the user in a rich, browsable view. Use it whenever the user asks to see, " +
			"look at, sample or browse data, rather than describing rows in prose; also to have data " +
			"checked before you train on it or push it, or a golden or eval set labelled. The turn " +
			"waits until the user sends the view back. Declare the record shape in `fields` and, to " +
			"collect labels, the " +
			"`questions`; with no questions the user marks records OK or rejects them. The user can " +
			"comment on any record, field or quoted span, and submits everything at once. You get " +
			"back what they did: counts, tallies, every comment, their note, and a file of per-record " +
			"answers (inline too when there are 20 records or fewer). " +
			`Records come from source: inline \`records\` for ${REVIEW_MAX_INLINE_RECORDS} or fewer, ` +
			"otherwise a virtual file, a sandbox path or an hf:// file holding a JSON array or JSONL, " +
			"or a .csv or .tsv passed as it is (its header row names the fields, cells are converted " +
			"to the declared types), a Hub `dataset` sampled through the dataset viewer, or a `parquet` " +
			"file or folder in a dataset repo or bucket, both read with no job; for those two, omit " +
			"`fields` to show every column by its dataset type, or declare fields to pick columns " +
			"(`column` names the source column when it differs). " +
			`at most ${REVIEW_MAX_RECORDS} records and 4 MB. Each record is an object with the ` +
			"id_field, one key per field, and optionally `suggestions`: " +
			'{"<question>": {"value": ..., "score": 0.7, "rationale": "..."}}, your own guess, kept ' +
			"apart from the human answer. Never put suggestions into field values. A golden or eval " +
			'set must use suggestions "after_answer" so your guesses do not anchor the labels.',
		parameters: {
			type: "object",
			properties: {
				title: {
					type: "string",
					description: 'Short name for the batch, e.g. "Issue triage golden set, batch 1".',
				},
				instructions: {
					type: "string",
					description: "Markdown shown above the records: what to look for, how to label.",
				},
				source: {
					type: "object",
					description: "Where the records are. Give exactly one key.",
					properties: {
						records: {
							type: "array",
							maxItems: REVIEW_MAX_INLINE_RECORDS,
							description: `Inline records, ${REVIEW_MAX_INLINE_RECORDS} at most.`,
							items: { type: "object" },
						},
						file: {
							type: "string",
							description:
								"A virtual file name, e.g. triage/batch-1.jsonl or sample.csv, or name@v2 to pin a version.",
						},
						sandbox: {
							type: "object",
							properties: {
								handle: { type: "string", description: "The sandbox handle." },
								path: { type: "string", description: "Absolute path of the file in the sandbox." },
							},
							required: ["handle", "path"],
						},
						hub: {
							type: "string",
							description: "An hf:// file URI, e.g. hf://datasets/org/repo/sample.jsonl.",
						},
						dataset: {
							type: "object",
							description:
								"A Hub dataset read through the dataset viewer, a few seconds for any size. " +
								"When the viewer is down or has not processed it, reads the repo's Parquet files, then " +
								"the viewer's refs/convert/parquet branch, then JSONL or CSV; where, query and image or " +
								"audio columns need the viewer. Never wait for the viewer, the tool falls back at once.",
							properties: {
								repo: { type: "string", description: 'e.g. "stanfordnlp/imdb".' },
								config: { type: "string", description: "Defaults to the first config." },
								split: { type: "string", description: 'Defaults to "train".' },
								revision: {
									type: "string",
									description: "A branch, tag or commit; the viewer serves only the latest.",
								},
								...SAMPLE_PROPERTIES,
								where: {
									type: "string",
									description: `A SQL WHERE clause, column names double quoted: "label" = 1 AND "lang" = 'en'.`,
								},
								query: { type: "string", description: "Full text search over the text columns." },
							},
							required: ["repo"],
						},
						parquet: {
							type: "object",
							description:
								"A Parquet file or folder, hf://datasets/org/repo/data/train-0.parquet or " +
								"hf://buckets/org/bucket/path/. Only the row groups and columns needed are read, " +
								"at most 64 MB.",
							properties: { uri: { type: "string" }, ...SAMPLE_PROPERTIES },
							required: ["uri"],
						},
					},
				},
				destination: {
					type: "object",
					description:
						"Where to write the reviewed rows and their answers as a Parquet file. After the " +
						"user submits, a card asks them to push, open a pull request or not push, showing who " +
						"will see it; the result says which. A later batch to the same path lands beside it.",
					properties: {
						repo: { type: "string", description: '"owner/name".' },
						type: { type: "string", enum: ["dataset", "bucket"] },
						path: { type: "string", description: 'e.g. "data/batch-1.parquet".' },
						pr: { type: "boolean", description: "Open a pull request instead of committing." },
					},
					required: ["repo"],
				},
				id_field: {
					type: "string",
					description: 'The record key that holds a unique id. Defaults to "id".',
				},
				fields: {
					type: "array",
					maxItems: REVIEW_LIMITS.fields,
					description: "How to show each record key. Omit when `schema` names a file.",
					items: {
						type: "object",
						properties: {
							name: { type: "string", description: "The record key, lowercase snake_case." },
							type: {
								type: "string",
								enum: [...REVIEW_FIELD_TYPES],
								description:
									"text, markdown, code, json, chat (a list of {role, content}), image " +
									"(an https or hf:// URL), audio or video (an https or hf:// URL, the user can comment on " +
									"a moment, a range or a box on a frame), number or category (shown as chips).",
							},
							title: { type: "string" },
							language: { type: "string", description: "For code fields." },
							column: {
								type: "string",
								description: "dataset and parquet sources: the column to read, when not the name.",
							},
						},
						required: ["name", "type"],
					},
				},
				questions: {
					type: "array",
					maxItems: REVIEW_LIMITS.questions,
					description: "What to ask about each record. Omit for a plain review.",
					items: {
						type: "object",
						properties: {
							name: { type: "string", description: "Lowercase snake_case, the answer key." },
							type: {
								type: "string",
								enum: [...REVIEW_QUESTION_TYPES],
								description:
									"label (one option), multi_label (several), rating (an integer from min to max, " +
									"at most 11 steps), boolean, or text.",
							},
							title: { type: "string" },
							description: { type: "string" },
							required: { type: "boolean" },
							target: {
								type: "string",
								description: "A field name, to ask about that field instead of the whole record.",
							},
							options: {
								type: "array",
								minItems: REVIEW_LIMITS.minOptions,
								maxItems: REVIEW_LIMITS.maxOptions,
								description: "For label and multi_label.",
								items: {
									type: "object",
									properties: {
										value: { type: "string" },
										title: { type: "string" },
										description: { type: "string" },
									},
									required: ["value"],
								},
							},
							min: {
								type: "integer",
								description: "rating: lowest value (default 1). multi_label: fewest picks.",
							},
							max: {
								type: "integer",
								description: "rating: highest value (default 5). multi_label: most picks.",
							},
							max_length: { type: "integer", description: "text: longest answer." },
						},
						required: ["name", "type"],
					},
				},
				schema: {
					type: "string",
					description:
						"A virtual file you already wrote, holding {fields, questions} as JSON, in place of " +
						"inline fields and questions. Reuse one file across batches of the same set so their " +
						"answers stay comparable. Omit it to declare fields and questions inline.",
				},
				suggestions: {
					type: "string",
					enum: [...REVIEW_SUGGESTION_MODES],
					description:
						'When the user sees your suggestions: "shown" (default), "after_answer" (required for ' +
						'golden and eval sets) or "none".',
				},
			},
			required: ["title", "source"],
		},
	},
};
