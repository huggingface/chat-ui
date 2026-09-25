import { z } from "zod";
import type { Conversation } from "$lib/types/Conversation";
import type { OpenAiTool } from "$lib/server/mcp/tools";
import { logger } from "$lib/server/logger";
import {
	applyFileEdits,
	formatVirtualFileRef,
	listMlFiles,
	ML_FILE_MAX_BYTES,
	readMlFile,
	summarizeChanges,
	validateMlFileContent,
	validateMlFileName,
	writeMlFileVersion,
	type MlFileListing,
} from "$lib/server/mlFiles";
import {
	EDIT_FILE_TOOL_NAME,
	READ_FILE_TOOL_NAME,
	VIRTUAL_FILE_REFERENCE_RULES as REFERENCE_RULES,
	VIRTUAL_FILES_TOOL_PREPROMPT,
	WRITE_FILE_TOOL_NAME,
} from "$lib/server/mlFiles/prompt";
import type { BuiltinTool, BuiltinToolContext, BuiltinToolResult } from "./types";

export { EDIT_FILE_TOOL_NAME, READ_FILE_TOOL_NAME, WRITE_FILE_TOOL_NAME };

const READ_MAX_CHARS = 40_000;
const MAX_EDITS_PER_CALL = 50;

const writeDefinition: OpenAiTool = {
	type: "function",
	function: {
		name: WRITE_FILE_TOOL_NAME,
		description:
			"Create a virtual file or replace one wholesale. Every script you run is a virtual " +
			"file: write it here once, then submit, upload or push it by reference instead of " +
			"pasting the content into the tool call. Each call is a new version; use edit_file " +
			`for a change smaller than the file. Text only, at most ${ML_FILE_MAX_BYTES / 1024} KB. ` +
			REFERENCE_RULES,
		parameters: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description:
						"Relative path-like name, e.g. train.py or configs/sft.yaml. Letters, digits, " +
						'".", "_", "-" and "/" only.',
				},
				content: { type: "string", description: "The whole file." },
				summary: {
					type: "string",
					description:
						"One line on what this version is or changes, e.g. 'first draft' or " +
						"'lower lr to 1e-5'. Shown in file listings.",
				},
			},
			required: ["name", "content"],
		},
	},
};

const editDefinition: OpenAiTool = {
	type: "function",
	function: {
		name: EDIT_FILE_TOOL_NAME,
		description:
			"Edit a virtual file by search-and-replace and get a new version back. Each pair " +
			"replaces the first occurrence of `old` with `new`, applied in order; whitespace and " +
			"quote style are matched loosely, so copy the text you want to change from read_file " +
			"rather than retyping it. All or nothing: a pair that matches nothing refuses the whole " +
			"call and no version is written. The result is the new version number and a short diff, " +
			"not the file.",
		parameters: {
			type: "object",
			properties: {
				name: { type: "string", description: "The file to edit." },
				edits: {
					type: "array",
					minItems: 1,
					maxItems: MAX_EDITS_PER_CALL,
					description: "Replacements, applied in order.",
					items: {
						type: "object",
						properties: {
							old: {
								type: "string",
								description:
									"Text to find — enough of it to be unique, and never empty. The first " +
									"occurrence is replaced.",
							},
							new: { type: "string", description: "Replacement text. Empty deletes." },
						},
						required: ["old", "new"],
					},
				},
				summary: {
					type: "string",
					description: "One line on what the edit changes, e.g. 'lower lr to 1e-5'.",
				},
				expected_version: {
					type: "integer",
					description:
						"The version you read before editing. If the file has moved on, the edit is " +
						"refused instead of applied to a version you have not seen.",
				},
			},
			required: ["name", "edits"],
		},
	},
};

const readDefinition: OpenAiTool = {
	type: "function",
	function: {
		name: READ_FILE_TOOL_NAME,
		description:
			"Read a virtual file with line numbers, or with no name list every file in this " +
			"conversation (name, latest version, size, summary). Use the listing to find your " +
			"files after a context rebuild, and a line range to read a region before editing " +
			`it. Output is capped at ${READ_MAX_CHARS.toLocaleString("en-US")} characters; ` +
			"page with start_line and end_line.",
		parameters: {
			type: "object",
			properties: {
				name: { type: "string", description: "The file to read. Omit to list files." },
				start_line: { type: "integer", description: "First line to return, 1-based." },
				end_line: { type: "integer", description: "Last line to return, inclusive." },
				version: {
					type: "integer",
					description: "A specific version. Omit for the latest.",
				},
			},
		},
	},
};

const nameSchema = z.string();
const summarySchema = z.string().optional();

const writeArgsSchema = z.object({
	name: nameSchema,
	content: z.string(),
	summary: summarySchema,
});

const editArgsSchema = z.object({
	name: nameSchema,
	edits: z
		.array(z.object({ old: z.string(), new: z.string() }))
		.min(1, "edits needs at least one {old, new} pair")
		.max(MAX_EDITS_PER_CALL, `at most ${MAX_EDITS_PER_CALL} edits per call`),
	summary: summarySchema,
	expected_version: z.number().int().positive().optional(),
});

const readArgsSchema = z.object({
	name: z.string().optional(),
	start_line: z.number().int().positive().optional(),
	end_line: z.number().int().positive().optional(),
	version: z.number().int().positive().optional(),
});

function argsError(tool: string, error: z.ZodError): string {
	const issue = error.issues[0];
	const path = issue?.path.join(".") ?? "";
	return `Invalid ${tool} arguments${path ? ` at ${path}` : ""}: ${issue?.message ?? "unknown"}.`;
}

const bytes = (size: number) => `${size.toLocaleString("en-US")} bytes`;

const excerpt = (text: string, max = 80): string => {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

function describeListing(files: MlFileListing[]): string {
	if (files.length === 0) {
		return `No virtual files in this conversation yet. Create one with ${WRITE_FILE_TOOL_NAME}.`;
	}
	const lines = files.map((file) => {
		const when = file.updatedAt.toISOString().slice(0, 16).replace("T", " ");
		return `  ${file.name}  v${file.version}  ${bytes(file.size)}  ${when}${
			file.summary ? `  — ${file.summary}` : ""
		}`;
	});
	return [`Virtual files in this conversation (${files.length}):`, ...lines].join("\n");
}

async function noSuchFile(conversationId: Conversation["_id"], name: string): Promise<string> {
	const files = await listMlFiles(conversationId);
	const known =
		files.length === 0
			? "There are no virtual files in this conversation yet."
			: `Files that exist: ${files.map((file) => `${file.name} (v${file.version})`).join(", ")}.`;
	return `No virtual file named "${name}". ${known}`;
}

function attribution(ctx: BuiltinToolContext) {
	return {
		...(ctx.messageId ? { messageId: ctx.messageId } : {}),
		...(ctx.generationId ? { generationId: ctx.generationId } : {}),
		toolUuid: ctx.uuid,
	};
}

async function writeFile(
	conv: Pick<Conversation, "_id">,
	args: Record<string, unknown>,
	ctx: BuiltinToolContext
): Promise<BuiltinToolResult> {
	const parsed = writeArgsSchema.safeParse(args);
	if (!parsed.success) return { error: argsError(WRITE_FILE_TOOL_NAME, parsed.error) };
	const name = validateMlFileName(parsed.data.name);
	if (!name.ok) return { error: name.error };
	const content = validateMlFileContent(parsed.data.content);
	if (!content.ok) return { error: content.error };

	const written = await writeMlFileVersion({
		conversationId: conv._id,
		name: name.value,
		content: content.value,
		origin: "write",
		summary: parsed.data.summary,
		attribution: attribution(ctx),
	});
	logger.info(
		{ conversationId: conv._id.toString(), name: written.name, version: written.version },
		"[mlFiles] file written"
	);
	return {
		resultText:
			`Wrote ${written.name} v${written.version} (${bytes(written.size)}, ${written.lineCount} lines). ` +
			`Reference it as ${formatVirtualFileRef(written.name)} for the latest version or ` +
			`${formatVirtualFileRef(written.name, written.version)} for this one.`,
	};
}

async function editFile(
	conv: Pick<Conversation, "_id">,
	args: Record<string, unknown>,
	ctx: BuiltinToolContext
): Promise<BuiltinToolResult> {
	const parsed = editArgsSchema.safeParse(args);
	if (!parsed.success) return { error: argsError(EDIT_FILE_TOOL_NAME, parsed.error) };
	const name = validateMlFileName(parsed.data.name);
	if (!name.ok) return { error: name.error };

	const current = await readMlFile(conv._id, name.value);
	if (!current) return { error: await noSuchFile(conv._id, name.value) };
	const expected = parsed.data.expected_version;
	if (expected !== undefined && expected !== current.version) {
		return {
			error:
				`${current.name} is at v${current.version}, not v${expected}; nothing was changed. ` +
				`${READ_FILE_TOOL_NAME} it and edit against the current version.`,
		};
	}

	const edits = parsed.data.edits;
	const applied = applyFileEdits(current.content, edits);
	if (!applied.ok) {
		const which = `Edit ${applied.index + 1} of ${edits.length}`;
		return {
			error:
				applied.reason === "empty"
					? `${which} has an empty \`old\`; nothing was changed. Every pair needs text to find.`
					: `${which} matched nothing in ${current.name} v${current.version} (old: "${excerpt(
							edits[applied.index].old
						)}"); nothing was changed. ${READ_FILE_TOOL_NAME} the region and copy the text exactly.`,
		};
	}
	const content = validateMlFileContent(applied.content);
	if (!content.ok) return { error: content.error };

	const written = await writeMlFileVersion({
		conversationId: conv._id,
		name: current.name,
		content: content.value,
		origin: "edit",
		summary: parsed.data.summary,
		attribution: attribution(ctx),
		baseVersion: current.version,
	});
	if ("conflict" in written) {
		return {
			error:
				`${current.name} moved from v${current.version} to v${written.latestVersion} while this edit was ` +
				`being applied, so it was not written. ${READ_FILE_TOOL_NAME} it and edit against the current version.`,
		};
	}
	logger.info(
		{
			conversationId: conv._id.toString(),
			name: written.name,
			version: written.version,
			edits: edits.length,
		},
		"[mlFiles] file edited"
	);
	const changes = summarizeChanges(current.content, content.value);
	return {
		resultText: [
			`${written.name} v${written.version} (was v${current.version}): ${edits.length} ${
				edits.length === 1 ? "edit" : "edits"
			} applied, now ${bytes(written.size)}, ${written.lineCount} lines.`,
			...(changes ? [changes] : ["(no textual change)"]),
		].join("\n"),
	};
}

async function readFile(
	conv: Pick<Conversation, "_id">,
	args: Record<string, unknown>
): Promise<BuiltinToolResult> {
	const parsed = readArgsSchema.safeParse(args);
	if (!parsed.success) return { error: argsError(READ_FILE_TOOL_NAME, parsed.error) };
	if (!parsed.data.name?.trim()) {
		return { resultText: describeListing(await listMlFiles(conv._id)) };
	}
	const name = validateMlFileName(parsed.data.name);
	if (!name.ok) return { error: name.error };

	const file = await readMlFile(conv._id, name.value, parsed.data.version);
	if (!file) {
		if (parsed.data.version !== undefined) {
			const latest = await readMlFile(conv._id, name.value);
			if (latest) {
				return {
					error: `${latest.name} has no v${parsed.data.version}; versions run v1 to v${latest.version}.`,
				};
			}
		}
		return { error: await noSuchFile(conv._id, name.value) };
	}

	const lines = file.content.split("\n");
	if (file.content.endsWith("\n")) lines.pop();
	const total = lines.length;
	const start = Math.min(parsed.data.start_line ?? 1, Math.max(total, 1));
	const end = Math.min(parsed.data.end_line ?? total, total);
	if (end < start) {
		return {
			error: `end_line (${end}) is before start_line (${start}); the file has ${total} lines.`,
		};
	}
	const width = String(end).length;
	const body: string[] = [];
	let length = 0;
	let last = start - 1;
	for (let n = start; n <= end; n += 1) {
		const line = `${String(n).padStart(width, " ")}| ${lines[n - 1]}`;
		if (length + line.length + 1 > READ_MAX_CHARS) break;
		body.push(line);
		length += line.length + 1;
		last = n;
	}
	const header = `${file.name} v${file.version} — lines ${start}-${last} of ${total} (${bytes(file.size)})`;
	const trailer =
		last < end
			? `… truncated at line ${last} of ${total}; call ${READ_FILE_TOOL_NAME} with start_line=${
					last + 1
				} to continue.`
			: undefined;
	return { resultText: [header, ...body, ...(trailer ? [trailer] : [])].join("\n") };
}

/**
 * bound at creation rather than read off the call context, a sub-agent run has no
 * chat context and its files must still land in the parent conversation
 */
export function createFileTools(conv: Pick<Conversation, "_id">): BuiltinTool[] {
	return [
		{
			name: WRITE_FILE_TOOL_NAME,
			definition: writeDefinition,
			exemptFromToolRestraint: true,
			preprompt: VIRTUAL_FILES_TOOL_PREPROMPT,
			execute: (args, ctx) => writeFile(conv, args, ctx),
		},
		{
			name: EDIT_FILE_TOOL_NAME,
			definition: editDefinition,
			exemptFromToolRestraint: true,
			execute: (args, ctx) => editFile(conv, args, ctx),
		},
		{
			name: READ_FILE_TOOL_NAME,
			definition: readDefinition,
			exemptFromToolRestraint: true,
			execute: (args) => readFile(conv, args),
		},
	];
}
