import {
	MessageUpdateType,
	MessageToolUpdateType,
	type MessageUpdate,
} from "$lib/types/MessageUpdate";
import { Lexer, type Token } from "marked";
import type { types, ViewStateValue } from "@slack/bolt";
import type {
	ElicitationField,
	ElicitationRequestPayload,
	ElicitationValue,
} from "$lib/types/McpElicitation";

type KnownBlock = types.KnownBlock;
type ModalView = types.ModalView;

export const ANSWER_ACTION = "ml_intern_answer";
export const ANSWER_VIEW = "ml_intern_answers";
export const STOP_ACTION = "ml_intern_stop";
export const RESUME_ACTION = "ml_intern_resume";

const plain = (text: string) => ({ type: "plain_text" as const, text, emoji: false });
export function chunks(text: string, size = 2800): string[] {
	// Split on code points, never between the halves of an emoji.
	const chars = Array.from(text || "No response text.");
	const parts: string[] = [];
	for (let i = 0; i < chars.length; i += size) parts.push(chars.slice(i, i + size).join(""));
	return parts;
}

export function visibleText(text: string): string {
	return text.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "").trim();
}

/** Render Markdown as Slack mrkdwn, without allowing model-authored Slack mentions. */
export function slackMarkdown(text: string): string {
	const escape = (value: string) =>
		value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	// Marked escapes inline text; decode its entities once before Slack escaping.
	const inlineText = (value: string) =>
		escape(
			value.replace(
				/&(amp|lt|gt|quot|#39);/g,
				(entity) =>
					({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" })[entity] ??
					entity
			)
		);
	const render = (tokens: Token[] = []): string =>
		tokens
			.map((token): string => {
				switch (token.type) {
					case "space":
						return "";
					case "paragraph":
						return `${render(token.tokens)}\n\n`;
					case "heading":
						return `*${render(token.tokens)}*\n\n`;
					case "strong":
						return `*${render(token.tokens)}*`;
					case "em":
						return `_${render(token.tokens)}_`;
					case "del":
						return `~${render(token.tokens)}~`;
					case "br":
						return "\n";
					case "code":
						return `\`\`\`\n${escape(token.text)}\n\`\`\`\n\n`;
					case "codespan":
						return `\`${inlineText(token.text)}\``;
					case "blockquote":
						return (
							render(token.tokens)
								.trim()
								.split("\n")
								.map((line) => `> ${line}`)
								.join("\n") + "\n\n"
						);
					case "list":
						return (
							token.items
								.map(
									(item: { tokens: Token[]; task?: boolean; checked?: boolean }, index: number) => {
										const prefix = token.ordered ? `${Number(token.start) + index}.` : "•";
										const body = render(item.tokens).trim().replace(/\n/g, "\n  ");
										return `${prefix} ${item.task ? (item.checked ? "☑ " : "☐ ") : ""}${body}`;
									}
								)
								.join("\n") + "\n\n"
						);
					case "link": {
						const label = render(token.tokens).replace(/\|/g, " ");
						if (!/^https?:\/\//i.test(token.href)) return label;
						const url = escape(token.href).replace(/\|/g, "%7C");
						return label === url ? `<${url}>` : `<${url}|${label}>`;
					}
					case "image":
						return /^https?:\/\//i.test(token.href)
							? `<${escape(token.href).replace(/\|/g, "%7C")}|${escape(token.text).replace(/\|/g, " ") || "Image"}>`
							: escape(token.text);
					case "hr":
						return "———\n\n";
					case "html":
						return escape(token.raw);
					case "def":
						return "";
					default:
						return "tokens" in token && token.tokens
							? render(token.tokens)
							: inlineText("text" in token ? token.text : token.raw);
				}
			})
			.join("");
	return render(Lexer.lex(text, { gfm: true })).trim();
}

export function messageBlocks(
	text: string,
	actions: Array<{ id: string; label: string; value: string }> = []
): KnownBlock[] {
	const formatted = slackMarkdown(text);
	return [
		{
			type: "section",
			text:
				formatted.length <= 3000
					? { type: "mrkdwn", text: formatted, verbatim: true }
					: plain(text),
		},
		...(actions.length
			? [
					{
						type: "actions" as const,
						elements: actions.map((a) => ({
							type: "button" as const,
							action_id: a.id,
							text: plain(a.label),
							value: a.value,
						})),
					},
				]
			: []),
	];
}

/** Full question/option copy remains visible; Slack's short option labels carry opaque indices. */
export function questionModal(request: ElicitationRequestPayload, threadId: string): ModalView {
	const blocks: KnownBlock[] = [
		{
			type: "section",
			text: plain(
				"Answers to assistant questions will be shared in this Slack thread when submitted."
			),
		},
	];
	for (const [index, field] of (request.fields ?? []).entries()) {
		const key = `q${index}`;
		if (index) blocks.push({ type: "divider" });
		blocks.push(...fieldBlocks(field, index));
		const label = plain((field.title ?? field.name).slice(0, 150));
		if (field.kind === "select") {
			const options = field.options.map((option, i) => ({
				text: plain(
					`${choiceLetter(i)}. ${option.setBudgetUsd !== undefined ? `$${option.setBudgetUsd.toFixed(2)} budget` : option.label}`.slice(
						0,
						75
					)
				),
				value: String(i),
			}));
			if (field.allowOther) options.push({ text: plain("Other (write below)"), value: "other" });
			blocks.push({
				type: "input",
				block_id: key,
				label,
				optional: !field.required,
				element: {
					type: field.multiple ? "multi_static_select" : "static_select",
					action_id: "answer",
					options,
				},
			});
			if (field.allowOther)
				blocks.push({
					type: "input",
					block_id: `${key}_other`,
					optional: true,
					label: plain("Your own answer"),
					element: { type: "plain_text_input", action_id: "answer", max_length: 200 },
				});
		} else if (field.kind === "boolean") {
			blocks.push({
				type: "input",
				block_id: key,
				label,
				optional: !field.required,
				element: {
					type: "static_select",
					action_id: "answer",
					options: ["true", "false"].map((value) => ({
						text: plain(value === "true" ? "Yes" : "No"),
						value,
					})),
				},
			});
		} else {
			blocks.push({
				type: "input",
				block_id: key,
				label,
				optional: !field.required,
				element: {
					type: "plain_text_input",
					action_id: "answer",
					max_length: Math.min(field.kind === "string" ? (field.maxLength ?? 3000) : 100, 3000),
				},
			});
		}
	}
	if (!blocks.length || blocks.length > 100)
		throw new Error("This question cannot fit in a Slack form.");
	return {
		type: "modal",
		callback_id: ANSWER_VIEW,
		title: plain("ML Intern question"),
		submit: plain("Share answers"),
		close: plain("Later"),
		private_metadata: JSON.stringify({ threadId, elicitationId: request.elicitationId }),
		blocks,
	};
}

export function readAnswers(
	request: ElicitationRequestPayload,
	values: Record<string, Record<string, ViewStateValue>>
): { content: Record<string, ElicitationValue>; errors: Record<string, string> } {
	const content: Record<string, ElicitationValue> = {};
	const errors: Record<string, string> = {};
	for (const [index, field] of (request.fields ?? []).entries()) {
		const key = `q${index}`;
		const input = values[key]?.answer;
		if (field.kind === "select") {
			const picked = field.multiple
				? (input?.selected_options ?? [])
				: input?.selected_option
					? [input.selected_option]
					: [];
			const selected: string[] = [];
			for (const option of picked) {
				if (option.value === "other" && field.allowOther) {
					const other = values[`${key}_other`]?.answer?.value?.trim();
					if (!other) errors[`${key}_other`] = "Write your answer here.";
					else selected.push(other);
				} else {
					const n = Number(option.value);
					if (!/^\d+$/.test(option.value) || !field.options[n])
						errors[key] = "Choose one of the offered options.";
					else selected.push(field.options[n].value);
				}
			}
			if (field.required && !selected.length && !errors[`${key}_other`])
				errors[key] = "Choose an answer.";
			if (selected.length) content[field.name] = field.multiple ? selected : selected[0];
		} else if (field.kind === "boolean") {
			const selected = input?.selected_option?.value;
			if (selected === "true" || selected === "false") content[field.name] = selected === "true";
			else if (field.required) errors[key] = "Choose Yes or No.";
		} else {
			const value = input?.value?.trim();
			if (!value) {
				if (field.required) errors[key] = "Enter an answer.";
				continue;
			}
			if (field.kind === "number") {
				const number = Number(value);
				if (
					!Number.isFinite(number) ||
					(field.integer && !Number.isInteger(number)) ||
					(field.minimum !== undefined && number < field.minimum) ||
					(field.maximum !== undefined && number > field.maximum)
				)
					errors[key] = "Enter a number within the requested range.";
				else content[field.name] = number;
			} else content[field.name] = value;
		}
	}
	return { content, errors };
}

/** Activity labels come from tool types, never private reasoning or tool arguments. */
export function activityText(updates: MessageUpdate[] = [], completedLookups = 0): string {
	const active = new Map<string, string>();
	let usedTools = false;
	for (const update of updates) {
		if (update.type !== MessageUpdateType.Tool) continue;
		if (update.subtype === MessageToolUpdateType.Call) {
			active.set(update.uuid, update.call.name);
			usedTools = true;
		} else if (
			update.subtype === MessageToolUpdateType.Result ||
			update.subtype === MessageToolUpdateType.Error
		) {
			active.delete(update.uuid);
		}
	}
	const names = [...active.values()];
	if (names.includes("research"))
		return `Researching sources…${completedLookups ? ` (${completedLookups} lookups completed)` : ""}`;
	if (names.some((n) => ["hf_fs", "hub_repo_details", "web_search", "web_fetch"].includes(n)))
		return "Looking up sources on the web and Hugging Face…";
	if (names.some((n) => ["hf_jobs", "hf_sandbox"].includes(n)))
		return "Working with remote compute…";
	if (names.length) return "Running tools…";
	return usedTools ? "Preparing the response…" : "Reviewing your request…";
}

export const PICK_ACTION = "ml_intern_pick_";
export function inlineField(request: ElicitationRequestPayload) {
	const field = request.fields?.[0];
	return request.fields?.length === 1 &&
		field?.kind === "select" &&
		!field.multiple &&
		field.options.length <= 5
		? field
		: undefined;
}
function optionLabel(option: { label: string; setBudgetUsd?: number }): string {
	return option.setBudgetUsd === undefined
		? option.label
		: `Set budget to $${option.setBudgetUsd.toFixed(2)}`;
}
function questionText(text: string) {
	return {
		type: "mrkdwn" as const,
		text: text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
	};
}
function choiceLetter(index: number): string {
	let label = "";
	for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
		label = String.fromCharCode(65 + ((n - 1) % 26)) + label;
	return label;
}
export const SELECT_ACTION = "ml_intern_select_";
export const SUBMIT_ACTION = "ml_intern_submit";
export function inlineQuestions(request: ElicitationRequestPayload) {
	const fields = request.fields ?? [];
	return (
		fields.length > 1 &&
		fields.length <= 5 &&
		fields.every(
			(f) => f.kind === "select" && !f.multiple && f.options.length > 0 && f.options.length <= 5
		)
	);
}
export function selectedAnswers(
	request: ElicitationRequestPayload,
	choices: Record<string, number> = {}
): Record<string, ElicitationValue> | undefined {
	if (!inlineQuestions(request)) return;
	const content: Record<string, ElicitationValue> = {};
	for (const [i, field] of (request.fields ?? []).entries()) {
		if (field.kind !== "select") return;
		const index = choices[String(i)];
		if (!Number.isInteger(index) || !field.options[index]) return;
		content[field.name] = field.options[index].value;
	}
	return content;
}
export function questionFormLabel(request: ElicitationRequestPayload): string | undefined {
	const field = inlineField(request);
	if (inlineQuestions(request))
		return request.fields?.some((f) => f.kind === "select" && f.allowOther)
			? "Other answers"
			: undefined;
	return field ? (field.allowOther ? "Other answer" : undefined) : "Answer questions";
}
function fieldBlocks(
	field: ElicitationField,
	index: number,
	answer?: ElicitationValue
): KnownBlock[] {
	const answers = Array.isArray(answer) ? answer : [answer];
	const blocks: KnownBlock[] = [];
	for (const part of chunks(`${index + 1}. ${field.description || field.title || field.name}`))
		blocks.push({ type: "section", text: questionText(part) });
	if (field.kind === "select")
		for (const [i, option] of field.options.entries()) {
			for (const part of chunks(
				`${choiceLetter(i)}. *${optionLabel(option)}*${answers.includes(option.value) ? " ✅" : ""}${option.description ? `\n${option.description}` : ""}`
			))
				blocks.push({ type: "section", text: questionText(part) });
		}
	if (answer !== undefined) {
		const custom = answers.filter(
			(value) => field.kind !== "select" || !field.options.some((option) => option.value === value)
		);
		if (custom.length)
			for (const part of chunks(`Answer: ${custom.join(", ")} ✅`))
				blocks.push({ type: "section", text: questionText(part) });
	}
	return blocks;
}
export function confirmedQuestionBlocks(
	request: ElicitationRequestPayload,
	content: Record<string, ElicitationValue>
): KnownBlock[] {
	return (request.fields ?? []).flatMap((field, index) => [
		...fieldBlocks(field, index, content[field.name]),
		{ type: "divider" as const },
	]);
}
export function questionBlocks(
	request: ElicitationRequestPayload,
	threadId: string,
	choices: Record<string, number> = {},
	revision = 0
): KnownBlock[] {
	const blocks: KnownBlock[] = [
		{
			type: "section",
			text: plain(
				"Please choose how to proceed. Only the person who started this task can submit answers. Confirmed answers will be shared in this thread."
			),
		},
	];
	for (const [index, field] of (request.fields ?? []).entries()) {
		blocks.push({ type: "divider" }, ...fieldBlocks(field, index));
		if (inlineQuestions(request) && field.kind === "select")
			blocks.push({
				type: "actions",
				elements: field.options.map((option, i) => ({
					type: "button",
					action_id: `${SELECT_ACTION}${index}_${i}`,
					text: plain(
						`${choices[String(index)] === i ? "✓ " : ""}${choiceLetter(i)}. ${optionLabel(option)}`.slice(
							0,
							75
						)
					),
					...(choices[String(index)] === i ? { style: "primary" as const } : {}),
					value: JSON.stringify({
						threadId,
						elicitationId: request.elicitationId,
						fieldIndex: index,
						optionIndex: i,
					}),
				})),
			});
	}
	const field = inlineField(request);
	if (field)
		blocks.push({
			type: "actions",
			elements: field.options.map((option, i) => ({
				type: "button",
				action_id: `${PICK_ACTION}${i}`,
				text: plain(`${choiceLetter(i)}. ${optionLabel(option)}`.slice(0, 75)),
				value: JSON.stringify({ threadId, elicitationId: request.elicitationId, optionIndex: i }),
				confirm: {
					title: plain(
						option.setBudgetUsd !== undefined ? "Approve compute budget" : "Confirm answer"
					),
					text: plain(
						option.setBudgetUsd !== undefined
							? `${optionLabel(option)} for this ML Intern session`
							: `${optionLabel(option)}\nYour answer will be shared in this thread.`
					),
					confirm: plain("Confirm"),
					deny: plain("Cancel"),
				},
			})),
		});
	if (inlineQuestions(request)) {
		const content = selectedAnswers(request, choices);
		if (content) {
			const confirmation = (request.fields ?? [])
				.map((field, i) => {
					if (field.kind !== "select") return "";
					const option = field.options[choices[String(i)]];
					return `${i + 1}: ${choiceLetter(choices[String(i)])}${option.setBudgetUsd !== undefined ? ` — Set budget to $${option.setBudgetUsd.toFixed(2)}` : ""}`;
				})
				.join("\n");
			blocks.push({
				type: "actions",
				elements: [
					{
						type: "button",
						action_id: SUBMIT_ACTION,
						style: "primary",
						text: plain("Submit answers"),
						value: JSON.stringify({ threadId, elicitationId: request.elicitationId, revision }),
						confirm: {
							title: plain("Confirm answers"),
							text: plain(
								`${confirmation}\nSubmit these selections and share them in this thread?`
							),
							confirm: plain("Submit"),
							deny: plain("Cancel"),
						},
					},
				],
			});
		} else
			blocks.push({
				type: "context",
				elements: [plain("Choose one answer for each question, then submit them together.")],
			});
	}
	blocks.push({ type: "divider" });
	// Large forms remain available in the modal; never exceed Slack's 50-block message limit.
	return blocks.length <= 45
		? blocks
		: [
				{
					type: "section",
					text: plain(
						"This question is too long to display in full. Choose an option below or open the question form if available. Confirmed answers will be shared in this thread."
					),
				},
				...blocks.filter((block) => block.type === "actions"),
				{ type: "divider" },
			];
}
export function answerSummary(
	request: ElicitationRequestPayload,
	content: Record<string, ElicitationValue>
): string {
	return (request.fields ?? [])
		.map((field) => {
			const value = content[field.name];
			const values = Array.isArray(value) ? value : [value];
			const answer = values
				.filter((v) => v !== undefined)
				.map((v) => {
					const option =
						field.kind === "select" ? field.options.find((o) => o.value === v) : undefined;
					return option ? optionLabel(option) : String(v);
				})
				.join(", ");
			return `${field.description || field.title || field.name}\nAnswer: ${answer || "Not provided"}`;
		})
		.join("\n\n");
}

/** Public assistant prose only; never reasoning streams or tool arguments. */
export function latestPublicUpdate(content: string): string {
	const paragraphs = visibleText(content.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "\n\n"))
		.split(/\n\s*\n/)
		.map((p) => p.trim())
		.filter(Boolean);
	const latest = paragraphs.at(-1)?.replace(/\s+/g, " ") ?? "";
	return latest.length > 320 ? `${latest.slice(0, 317)}…` : latest;
}
export function createdSpaceLinks(updates: MessageUpdate[] = []): string[] {
	const links = new Set<string>();
	const calls = new Map<string, Record<string, string | number | boolean>>();
	for (const update of updates) {
		if (
			update.type === MessageUpdateType.Tool &&
			update.subtype === MessageToolUpdateType.Call &&
			update.call.name === "create_repo"
		)
			calls.set(update.uuid, update.call.parameters);
		if (
			update.type !== MessageUpdateType.Tool ||
			update.subtype !== MessageToolUpdateType.Result ||
			update.result.status !== "success" ||
			update.result.call.name !== "create_repo"
		)
			continue;
		const uri = calls.get(update.uuid)?.uri ?? update.result.call.parameters.uri;
		if (typeof uri !== "string") continue;
		const match = /^hf:\/\/spaces\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/.exec(uri);
		if (match) links.add(`https://huggingface.co/spaces/${match[1]}`);
	}
	return [...links].slice(-3);
}

/** Keep all observed public prose, including when a resumed generation replaces its content. */
export function retainPublicUpdates(
	previous: string,
	snapshot: string,
	content: string
): { text: string; snapshot: string } {
	const current = visibleText(content.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "\n\n"));
	if (!current || current === snapshot || snapshot.startsWith(current))
		return { text: previous, snapshot };
	const text =
		snapshot && current.startsWith(snapshot)
			? previous + current.slice(snapshot.length)
			: previous
				? `${previous}\n\n${current}`
				: current;
	return { text, snapshot: current };
}
