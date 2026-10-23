import { z } from "zod";
import type { Conversation } from "$lib/types/Conversation";
import type { OpenAiTool } from "$lib/server/mcp/tools";
import { isHfMcpServer } from "$lib/server/mcp/hf";
import { logger } from "$lib/server/logger";
import {
	formatVirtualFileRef,
	ML_FILE_MAX_BYTES,
	readMlFile,
	summarizeChanges,
	validateMlFileContent,
	validateMlFileName,
	writeMlFileVersion,
} from "$lib/server/mlFiles";
import { IMPORT_FILE_TOOL_NAME, WRITE_FILE_TOOL_NAME } from "$lib/server/mlFiles/prompt";
import { errorText, readHubPage, readSandboxPage, readWhole } from "$lib/server/mlFiles/remoteRead";
import { describeBytes, fileAttribution } from "./fileTools";
import type { NestedAgentBuiltinTool, NestedAgentDeps } from "./nestedAgent";
import type { BuiltinToolContext, BuiltinToolResult } from "./types";

export { IMPORT_FILE_TOOL_NAME };

/**
 * the harness reads the file so no content crosses a model context, the sub-agent
 * imports and the parent submits the version
 */

const MAX_PAGES = 32;

const definition: OpenAiTool = {
	type: "function",
	function: {
		name: IMPORT_FILE_TOOL_NAME,
		description:
			"Store a file that lives in a sandbox or on the Hub as a new version of a virtual file. " +
			"The file is read here, not by you: its pages are fetched and joined before anything " +
			"is written, and the result is the new version number, size and a short diff against " +
			"the previous version, never the content. Use it once a script has been fixed where it " +
			"runs, so the virtual file you submit is the one that worked, instead of reading the " +
			`file and pasting it into ${WRITE_FILE_TOOL_NAME}. Content identical to the latest ` +
			`version writes nothing. Text only, at most ${ML_FILE_MAX_BYTES / 1024} KB.`,
		parameters: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description:
						"The virtual file to add the version to, e.g. train.py. A name that does not exist " +
						"yet is created at v1.",
				},
				source: {
					description:
						"Where to read from: an hf:// file URI as a string, or a sandbox location " +
						'{"handle": "<sandbox handle>", "path": "/absolute/path/in/the/sandbox"}.',
					anyOf: [
						{
							type: "string",
							description: "A Hub file URI, e.g. hf://models/org/repo/train.py.",
						},
						{
							type: "object",
							properties: {
								handle: {
									type: "string",
									description: "The sandbox handle from hf_sandbox create.",
								},
								path: { type: "string", description: "Absolute path inside the sandbox." },
							},
							required: ["handle", "path"],
						},
					],
				},
				summary: {
					type: "string",
					description:
						"One line on what this version is, e.g. 'fixed in the sandbox: column name'. " +
						"Shown in file listings.",
				},
			},
			required: ["name", "source"],
		},
	},
};

const hubSourceSchema = z
	.string()
	.trim()
	.regex(/^hf:\/\/\S+$/, "a Hub source is an hf:// file URI");
const sandboxSourceSchema = z.object({
	handle: z.string().trim().min(1, "the sandbox handle is empty"),
	path: z.string().trim().min(1, "the sandbox path is empty"),
});
const argsSchema = z.object({
	name: z.string(),
	source: z.union([hubSourceSchema, sandboxSourceSchema]),
	summary: z.string().optional(),
});

function argsError(error: z.ZodError): string {
	const issue = error.issues[0];
	const path = issue?.path.join(".") ?? "";
	if (path === "source" && issue?.code === "invalid_union") {
		return `Invalid ${IMPORT_FILE_TOOL_NAME} arguments at source: pass an hf:// file URI, or {"handle", "path"} for a sandbox file.`;
	}
	return `Invalid ${IMPORT_FILE_TOOL_NAME} arguments${path ? ` at ${path}` : ""}: ${
		issue?.message ?? "unknown"
	}.`;
}

const tooLarge = (location: string, size: number) =>
	`${location} is ${describeBytes(size)} or more; a virtual file is at most ${
		ML_FILE_MAX_BYTES / 1024
	} KB per version, so it was not imported. Keep data out of scripts and load it from the Hub.`;

async function importFile(
	conv: Pick<Conversation, "_id">,
	args: Record<string, unknown>,
	ctx: BuiltinToolContext,
	deps: NestedAgentDeps | undefined
): Promise<BuiltinToolResult> {
	const parsed = argsSchema.safeParse(args);
	if (!parsed.success) return { error: argsError(parsed.error) };
	const name = validateMlFileName(parsed.data.name);
	if (!name.ok) return { error: name.error };
	if (!deps) return { error: "Import tool not initialized for this request." };
	const server = deps.servers.find((candidate) => isHfMcpServer(candidate.url));
	if (!server) {
		return {
			error:
				"No Hugging Face MCP server is connected in this turn, so there is nothing to read the file from.",
		};
	}

	const source = parsed.data.source;
	const location = typeof source === "string" ? source : `${source.handle}:${source.path}`;
	const signal = ctx.abortSignal;
	let read: Awaited<ReturnType<typeof readWhole>>;
	try {
		read = await readWhole(
			(offset) =>
				typeof source === "string"
					? readHubPage(server, source, offset, signal)
					: readSandboxPage(server, source, offset, signal),
			location,
			{ maxBytes: ML_FILE_MAX_BYTES, maxPages: MAX_PAGES, tooLarge }
		);
	} catch (err) {
		if (signal?.aborted) return { error: "Aborted by user" };
		const message = err instanceof Error ? err.message : String(err);
		logger.warn(
			{ conversationId: conv._id.toString(), name: name.value, source: location, err: message },
			"[mlFiles] import read failed"
		);
		return { error: `Could not read ${location}: ${errorText(message)}` };
	}
	if ("error" in read) return read;
	const content = validateMlFileContent(read.content);
	if (!content.ok) return { error: content.error };

	const previous = await readMlFile(conv._id, name.value);
	if (previous && previous.content === content.value) {
		return {
			resultText: `${previous.name} v${previous.version} is already identical to ${location}; nothing was written.`,
		};
	}
	const written = await writeMlFileVersion({
		conversationId: conv._id,
		name: name.value,
		content: content.value,
		origin: "import",
		source: location,
		summary: parsed.data.summary,
		attribution: fileAttribution(ctx),
	});
	logger.info(
		{
			conversationId: conv._id.toString(),
			name: written.name,
			version: written.version,
			source: location,
			...(ctx.agent ? { agent: ctx.agent } : {}),
		},
		"[mlFiles] file imported"
	);
	const changes = previous ? summarizeChanges(previous.content, content.value) : "";
	return {
		resultText: [
			`Imported ${written.name} v${written.version} from ${location} (${describeBytes(written.size)}, ${
				written.lineCount
			} lines; ${previous ? `was v${previous.version}` : "first version"}).`,
			...(previous ? [changes || "(no textual change)"] : []),
			`Reference it as ${formatVirtualFileRef(written.name)} for the latest version or ` +
				`${formatVirtualFileRef(written.name, written.version)} for this one.`,
		].join("\n"),
	};
}

/**
 * bound like the sub-agents although it runs no loop, the hub server is only known once
 * runMcpFlow resolves the turn
 */
export function createImportFileTool(conv: Pick<Conversation, "_id">): NestedAgentBuiltinTool {
	let deps: NestedAgentDeps | undefined;
	return {
		name: IMPORT_FILE_TOOL_NAME,
		definition,
		exemptFromToolRestraint: true,
		bind(next: NestedAgentDeps) {
			deps = next;
		},
		execute: (args, ctx) => importFile(conv, args, ctx, deps),
	};
}
