import type { ObjectId } from "mongodb";
import { isHfMcpServer } from "$lib/server/mcp/hf";
import { listMlFiles, readMlFile } from "./store";
import { formatVirtualFileRef, parseVirtualFileRef } from "./refs";

/**
 * runs beside attachFileRefsToArgs in the executor, after the persisted call update
 * takes its parameters and on the dispatched copy only, so the transcript, the next
 * round tool_calls message and replay all keep the reference
 *
 * not a ToolArgsRewrite, that hook rewrites the call itself so everything downstream
 * sees the server arguments, the opposite of what a reference needs
 */

export interface ResolvedVirtualFileRef {
	/** as the model wrote it */
	ref: string;
	name: string;
	/** the version that was sent */
	version: number;
}

export type VirtualFileExpansion =
	| { args: Record<string, unknown>; fileRefs: ResolvedVirtualFileRef[] }
	/** nothing may be dispatched, error says which reference failed */
	| { error: string };

export type VirtualFileExpander = (call: {
	serverUrl: string;
	tool: string;
	args: Record<string, unknown>;
}) => Promise<VirtualFileExpansion>;

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
	typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;

/**
 * the one position per tool that takes a whole file, script also accepts a URL so an
 * unexpanded reference there would start a job that bills and fails
 *
 * run has no script, its command is argv for a container that never sees a virtual file
 */
type ReferenceSlot = { value: unknown; replace: (content: string) => Record<string, unknown> };

function referenceSlot(tool: string, args: Record<string, unknown>): ReferenceSlot | undefined {
	if (tool === "hf_jobs") {
		if (args.operation !== "uv" && args.operation !== "scheduled uv") return undefined;
		const inner = asRecord(args.args);
		if (!inner || typeof inner.script !== "string") return undefined;
		return {
			value: inner.script,
			replace: (content) => ({ ...args, args: { ...inner, script: content } }),
		};
	}
	if (tool === "hf_fs_write") {
		if (args.cmd !== "put" || typeof args.content !== "string") return undefined;
		return { value: args.content, replace: (content) => ({ ...args, content }) };
	}
	if (tool === "hf_sandbox_fs") {
		if (args.cmd !== "write" || !Array.isArray(args.args)) return undefined;
		const tokens = args.args as unknown[];
		const index = tokens.indexOf("--text") + 1;
		if (index === 0 || typeof tokens[index] !== "string") return undefined;
		return {
			value: tokens[index],
			replace: (content) => ({
				...args,
				args: tokens.map((token, i) => (i === index ? content : token)),
			}),
		};
	}
	return undefined;
}

async function describeUnresolved(conversationId: ObjectId, name: string, version?: number) {
	const files = await listMlFiles(conversationId);
	const known = files.find((file) => file.name === name);
	if (known && version !== undefined) {
		return `${name} has no v${version}; its versions run v1 to v${known.version}.`;
	}
	const existing =
		files.length === 0
			? "There are no virtual files in this conversation yet: write one with write_file first."
			: `Files that exist: ${files
					.map((file) => `${formatVirtualFileRef(file.name)} (v${file.version})`)
					.join(", ")}.`;
	return `There is no virtual file named ${name}. ${existing}`;
}

function commandTokens(tool: string, args: Record<string, unknown>): string[] {
	if (tool !== "hf_jobs") return [];
	if (args.operation !== "run" && args.operation !== "scheduled run") return [];
	const command = asRecord(args.args)?.command;
	if (typeof command === "string")
		return command.split(/\s+/).map((t) => t.replace(/^['"]|['"]$/g, ""));
	if (Array.isArray(command)) return command.filter((t): t is string => typeof t === "string");
	return [];
}

/**
 * a job that names a virtual file in its command fails on a missing file after it has
 * started billing, the bare name matches because that is how the model writes it
 */
async function refuseCommandFileUse(
	conversationId: ObjectId,
	tool: string,
	args: Record<string, unknown>
): Promise<string | undefined> {
	const tokens = commandTokens(tool, args);
	if (tokens.length === 0) return undefined;
	const byRef = tokens.map((token) => parseVirtualFileRef(token)).find((ref) => ref);
	let name = byRef?.name;
	const version = byRef?.version;
	if (!name) {
		const files = await listMlFiles(conversationId);
		const names = new Set(files.map((file) => file.name));
		name = tokens.map((token) => token.trim().replace(/^\.\//, "")).find((t) => names.has(t));
	}
	if (!name) return undefined;
	const operation = args.operation === "scheduled run" ? "scheduled uv" : "uv";
	return (
		`${name} is a virtual file and the container of a ${String(args.operation)} job never ` +
		`receives it, so nothing was sent. Submit it with ${operation}: ` +
		`{"operation": "${operation}", "args": {"script": "${formatVirtualFileRef(name, version)}"}}, ` +
		`with third-party imports in with_deps and its arguments in script_args.`
	);
}

/** hub servers only, a custom server may mean something else by script */
export function createVirtualFileExpander(conversationId: ObjectId): VirtualFileExpander {
	return async ({ serverUrl, tool, args }) => {
		if (!isHfMcpServer(serverUrl)) return { args, fileRefs: [] };
		const refusal = await refuseCommandFileUse(conversationId, tool, args);
		if (refusal) return { error: refusal };
		const slot = referenceSlot(tool, args);
		const ref = slot ? parseVirtualFileRef(slot.value) : undefined;
		if (!slot || !ref) return { args, fileRefs: [] };

		const file = await readMlFile(conversationId, ref.name, ref.version);
		if (!file) {
			return {
				error: `${ref.ref} does not resolve, so nothing was sent. ${await describeUnresolved(
					conversationId,
					ref.name,
					ref.version
				)}`,
			};
		}
		return {
			args: slot.replace(file.content),
			fileRefs: [{ ref: ref.ref, name: file.name, version: file.version }],
		};
	};
}
