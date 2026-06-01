import { randomUUID } from "crypto";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { MessageToolUpdateType, MessageUpdateType } from "$lib/types/MessageUpdate";
import { ToolResultStatus } from "$lib/types/Tool";
import { config } from "$lib/server/config";
import type { OpenAiTool } from "$lib/server/mcp/tools";
import type { NormalizedToolCall, ToolExecutionEvent } from "../mcp/toolInvocation";
import { CodeDocState, type CodeDoc } from "./codeDocuments";

export const EDIT_TOOL_NAME = "edit";

export interface EditOp {
	oldText: string;
	newText: string;
}

export class EditError extends Error {}

/** The built-in edit tool is enabled by default; allow opting out via env. */
export function isEditToolEnabled(): boolean {
	return config.ENABLE_EDIT_TOOL !== "false";
}

export const editToolDefinition: OpenAiTool = {
	type: "function",
	function: {
		name: EDIT_TOOL_NAME,
		description:
			"Edit a code block you previously produced in this conversation using exact text replacement, " +
			"instead of retyping the whole block. Reference the block by the path/filename written after the " +
			'language on its code fence (e.g. a fence opened with ```python app.py has path "app.py"). Every ' +
			"edits[].oldText must match a unique, non-overlapping region of that code block. The updated code " +
			"block is shown to the user automatically, so you do not need to repeat it.",
		parameters: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description:
						"Path/filename identifying which code block to edit (the label after the language on its " +
						"code fence). May be omitted to edit the most recent code block when only one is in play.",
				},
				edits: {
					type: "array",
					minItems: 1,
					description:
						"One or more targeted replacements. Each edit is matched against the original code block, " +
						"not incrementally. Do not include overlapping or nested edits; merge them into one edit instead.",
					items: {
						type: "object",
						properties: {
							oldText: {
								type: "string",
								description:
									"Exact text for one targeted replacement. It must match a unique region of the target code block.",
							},
							newText: {
								type: "string",
								description: "Replacement text for this targeted edit.",
							},
						},
						required: ["oldText", "newText"],
						additionalProperties: false,
					},
				},
			},
			required: ["edits"],
			additionalProperties: false,
		},
	},
};

const CRLF = /\r\n/g;

export interface ApplyEditsResult {
	content: string;
	replaced: number;
}

/**
 * Apply exact-text replacements to `original`, mirroring pi's edit semantics: every
 * oldText must match a unique, non-overlapping region of the original content, and edits
 * are all matched against the original (not applied incrementally).
 */
export function applyEdits(original: string, edits: EditOp[]): ApplyEditsResult {
	if (!Array.isArray(edits) || edits.length === 0) {
		throw new EditError("Provide at least one edit with oldText and newText.");
	}

	const usedCRLF = original.includes("\r\n");
	const content = original.replace(CRLF, "\n");

	const matches = edits.map((edit, index) => {
		if (typeof edit?.oldText !== "string" || typeof edit?.newText !== "string") {
			throw new EditError(`Edit #${index + 1} must include string oldText and newText.`);
		}
		const needle = edit.oldText.replace(CRLF, "\n");
		if (needle.length === 0) {
			throw new EditError(`Edit #${index + 1} has an empty oldText.`);
		}
		const first = content.indexOf(needle);
		if (first === -1) {
			throw new EditError(
				`Could not find the oldText for edit #${index + 1}. It must match the current code block exactly.`
			);
		}
		if (content.indexOf(needle, first + 1) !== -1) {
			throw new EditError(
				`The oldText for edit #${index + 1} is not unique. Add surrounding context so it matches exactly one location.`
			);
		}
		return {
			start: first,
			end: first + needle.length,
			newText: edit.newText.replace(CRLF, "\n"),
		};
	});

	const sorted = [...matches].sort((a, b) => a.start - b.start);
	for (let i = 1; i < sorted.length; i += 1) {
		if (sorted[i].start < sorted[i - 1].end) {
			throw new EditError("Edits overlap. Merge overlapping edits into a single edit.");
		}
	}

	let result = content;
	for (let i = sorted.length - 1; i >= 0; i -= 1) {
		const match = sorted[i];
		result = result.slice(0, match.start) + match.newText + result.slice(match.end);
	}

	if (usedCRLF) result = result.replace(/\n/g, "\r\n");
	return { content: result, replaced: edits.length };
}

/** Choose a fence long enough that the content's own backticks can't close it early. */
function fenceFor(content: string): string {
	let longest = 0;
	const runs = content.match(/`+/g);
	if (runs) {
		for (const run of runs) longest = Math.max(longest, run.length);
	}
	return "`".repeat(Math.max(3, longest + 1));
}

/** Render a code document back into a markdown code block, preserving language + path. */
export function renderCodeBlock(doc: CodeDoc): string {
	const fence = fenceFor(doc.content);
	const info = [doc.language, doc.path].filter((part) => part && part.length > 0).join(" ");
	const body = doc.content.replace(/\n+$/, "");
	return `${fence}${info}\n${body}\n${fence}`;
}

function truncate(text: string, max = 200): string {
	const oneLine = text.replace(/\s+/g, " ").trim();
	return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

function summarizeEdits(edits: EditOp[]): string {
	return edits
		.map(
			(edit, index) =>
				`@@ edit ${index + 1}\n- ${truncate(edit.oldText)}\n+ ${truncate(edit.newText)}`
		)
		.join("\n");
}

function parseEditArgs(args: Record<string, unknown>): {
	path?: string;
	edits: EditOp[];
	rawEdits: unknown;
} {
	const path = typeof args.path === "string" && args.path.trim().length > 0 ? args.path : undefined;
	const rawEdits = args.edits;
	const edits: EditOp[] = [];
	if (Array.isArray(rawEdits)) {
		for (const entry of rawEdits) {
			if (entry && typeof entry === "object") {
				const obj = entry as Record<string, unknown>;
				if (typeof obj.oldText === "string" && typeof obj.newText === "string") {
					edits.push({ oldText: obj.oldText, newText: obj.newText });
				}
			}
		}
	}
	return { path, edits, rawEdits };
}

/**
 * Execute `edit` tool calls locally against the conversation's code blocks. Yields the
 * same event protocol as MCP tool execution so the streaming loop can treat both uniformly:
 * a `Call` update, the rebuilt code block as a `Stream` update (which becomes part of the
 * persisted answer), and a `Result`/`Error` update — plus the tool messages fed back to
 * the model so it knows the current state for follow-up edits.
 */
export async function* runEditToolCalls({
	calls,
	docState,
	parseArgs,
}: {
	calls: NormalizedToolCall[];
	docState: CodeDocState;
	parseArgs: (raw: unknown) => Record<string, unknown>;
}): AsyncGenerator<ToolExecutionEvent, void, undefined> {
	const toolMessages: ChatCompletionMessageParam[] = [];

	for (const call of calls) {
		const uuid = randomUUID();
		const { path, edits, rawEdits } = parseEditArgs(parseArgs(call.arguments));
		const displayParams: Record<string, string | number | boolean> = {
			...(path ? { path } : {}),
			edits: JSON.stringify(rawEdits ?? []),
		};

		yield {
			type: "update",
			update: {
				type: MessageUpdateType.Tool,
				subtype: MessageToolUpdateType.Call,
				uuid,
				call: { name: EDIT_TOOL_NAME, parameters: displayParams },
			},
		};

		try {
			const target = docState.lookup(path);
			if (!target) {
				const known = docState.knownPaths();
				if (path) {
					throw new EditError(
						`No code block found for path "${path}".` +
							(known.length > 0
								? ` Known code blocks: ${known.join(", ")}.`
								: " No labeled code blocks exist yet — write the code in a fenced block first.")
					);
				}
				throw new EditError(
					known.length > 0
						? `Specify which code block to edit via "path". Known code blocks: ${known.join(", ")}.`
						: "There is no code block to edit yet — write the code in a fenced block first."
				);
			}

			const { content, replaced } = applyEdits(target.content, edits);
			const updated: CodeDoc = { path: target.path, language: target.language, content };
			docState.record(updated);

			// Inject the rebuilt block into the visible answer (concatenated into
			// message.content), so the user sees the full updated code without the model
			// retyping it — and so a later turn can find the latest version in the transcript.
			yield {
				type: "update",
				update: {
					type: MessageUpdateType.Stream,
					token: `\n\n${renderCodeBlock(updated)}\n\n`,
				},
			};

			const label = target.path ? `\`${target.path}\`` : "the code block";
			yield {
				type: "update",
				update: {
					type: MessageUpdateType.Tool,
					subtype: MessageToolUpdateType.Result,
					uuid,
					result: {
						status: ToolResultStatus.Success,
						call: { name: EDIT_TOOL_NAME, parameters: displayParams },
						outputs: [
							{
								text: `Replaced ${replaced} block(s)${
									target.path ? ` in ${target.path}` : ""
								}.\n${summarizeEdits(edits)}`,
							},
						],
						display: true,
					},
				},
			};

			toolMessages.push({
				role: "tool",
				tool_call_id: call.id,
				content:
					`Successfully replaced ${replaced} block(s) in ${label}. ` +
					"The updated code block has been shown to the user; do not repeat it. " +
					`Current content of ${label}:\n${renderCodeBlock(updated)}`,
			});
		} catch (err) {
			const message =
				err instanceof EditError ? err.message : err instanceof Error ? err.message : String(err);
			yield {
				type: "update",
				update: {
					type: MessageUpdateType.Tool,
					subtype: MessageToolUpdateType.Error,
					uuid,
					message,
				},
			};
			toolMessages.push({ role: "tool", tool_call_id: call.id, content: `Error: ${message}` });
		}
	}

	yield { type: "complete", summary: { toolMessages, toolRuns: [] } };
}
