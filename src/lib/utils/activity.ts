import { ToolResultStatus } from "$lib/types/Tool";
import type { MessageToolUpdate, MessageUpdate } from "$lib/types/MessageUpdate";
import {
	isMessageActivityLabelUpdate,
	isMessageActivityTimingUpdate,
	isMessageToolCallUpdate,
	isMessageToolErrorUpdate,
	isMessageToolResultUpdate,
} from "./messageUpdates";
import { callArguments } from "./messageShape";
import { redactToolArguments } from "./redactSecrets";

/**
 * Rule-based labels for the compact activity view: what a tool call is doing, in words, and a
 * one-line summary of a finished run of calls. The task model only writes the live line and the
 * thinking summaries (see MessageActivityLabelUpdate); everything here is deterministic.
 */

export type ActivityKind =
	"search" | "page" | "code" | "create" | "write" | "file" | "image" | "lookup" | "other";

/** "stopped": the turn ended before the call returned */
export type ToolStatus = "running" | "done" | "error" | "stopped";

export interface ToolActivity {
	name: string;
	kind: ActivityKind;
	status: ToolStatus;
	/** what the row says for its status, e.g. "Searched the web" or "Couldn't read lmarena.ai" */
	verb: string;
	/** what the call acted on, e.g. the query, a file path or a repo id */
	subject?: string;
	/** the subject is an identifier (path, repo id, command) rather than prose */
	mono?: boolean;
	/** a secondary detail shown muted, e.g. a jobs operation or "+2 more" */
	detail?: string;
	/** this call alone in a summary, past tense and lowercase, e.g. "read arena.ai" */
	phrase: string;
	/** this call failing, lowercase, e.g. "couldn't read arena.ai" */
	failPhrase: string;
	/** calls with the same key are counted together in a summary */
	groupKey: string;
	/** several calls of this key in a summary, lowercase */
	plural: (count: number) => string;
}

/** The parts of a description that do not depend on the call's status. */
interface Action {
	kind: ActivityKind;
	/** "Searching the web" */
	gerund: string;
	/** "Searched the web" */
	past: string;
	/** "search the web", for "Couldn't …" */
	infinitive: string;
	subject?: string;
	mono?: boolean;
	detail?: string;
	groupKey?: string;
	plural?: (count: number) => string;
}

const WEB_HINT = /web|exa|tavily|brave|google|bing|duckduckgo|serp/;

export function classifyTool(name: string): ActivityKind {
	const n = name.toLowerCase();
	if (n === "read_file" || n === "hf_fs" || n === "hf_sandbox_fs") return "file";
	if (n === "write_file" || n === "edit_file" || n === "import_file" || n === "hf_fs_write") {
		return "write";
	}
	if (n === "hf_whoami" || n === "check_job") return "lookup";
	if (n === "research" || n === "wait" || n === "hf_jobs") return "other";
	if (/image|flux|diffusion|sdxl|txt2img/.test(n)) return "image";
	if (/search|query/.test(n)) return "search";
	if (/crawl|fetch|scrape|browse|read_url|webpage|get_page/.test(n)) return "page";
	if (/python|exec|run_code|bash|shell|sandbox|terminal/.test(n)) return "code";
	if (/^create_/.test(n)) return "create";
	if (/upload|write|commit|edit|patch/.test(n)) return "write";
	if (/^read_|^list_|^get_|whoami|_info$|status|runtime|details/.test(n)) return "lookup";
	return "other";
}

/** "hf_doc_search" -> "doc search", for names nothing else describes */
export function humanizeToolName(name: string): string {
	return name
		.replace(/^(hf_|mcp_)/, "")
		.replace(/_(exa|tool)$/, "")
		.replace(/[_-]+/g, " ")
		.trim();
}

const asString = (value: unknown): string | undefined =>
	typeof value === "string" && value.trim() ? value.trim() : undefined;

const firstString = (args: Record<string, unknown>, keys: string[]): string | undefined => {
	for (const key of keys) {
		const value = args[key];
		const text = asString(value) ?? (Array.isArray(value) ? asString(value[0]) : undefined);
		if (text) return text;
	}
	return undefined;
};

const stringList = (value: unknown): string[] =>
	Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

const domainOf = (url: string | undefined): string | undefined => {
	if (!url) return undefined;
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return undefined;
	}
};

const basename = (path: string) => path.split("/").filter(Boolean).pop() ?? path;

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

const capFirst = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const shorten = (text: string, max = 80) =>
	text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** what a search covers, from its name: "paper_search" -> "papers", "web_search_exa" -> "the web" */
function searchTarget(name: string): string | undefined {
	const n = name.toLowerCase();
	if (WEB_HINT.test(n)) return "the web";
	const rest = humanizeToolName(n)
		.replace(/\b(search|query|find|lookup)\b/g, "")
		.trim();
	if (!rest) return undefined;
	return rest.endsWith("s") ? rest : `${rest}s`;
}

/** a CLI-style argument list: positionals, and the value after a flag */
function cliArgs(list: string[]) {
	const positional: string[] = [];
	const flags: Record<string, string> = {};
	for (let i = 0; i < list.length; i += 1) {
		const item = list[i];
		if (item.startsWith("--")) {
			const [flag, inline] = item.slice(2).split("=", 2);
			if (inline !== undefined) flags[flag] = inline;
			else if (list[i + 1] !== undefined && !list[i + 1].startsWith("--")) flags[flag] = list[++i];
			else flags[flag] = "";
		} else {
			positional.push(item);
		}
	}
	return { positional, flags };
}

/** "hf://datasets/HuggingFaceFW/finephrase/README.md" -> scope "datasets", rest "HuggingFaceFW/…" */
function hubUri(uri: string | undefined) {
	if (!uri) return undefined;
	const path = uri.replace(/^hf:\/\//, "");
	const [scope, ...rest] = path.split("/");
	return { path, scope, rest: rest.join("/") };
}

const HUB_SCOPES: Record<string, string> = {
	spaces: "Spaces",
	models: "models",
	datasets: "datasets",
	buckets: "buckets",
	papers: "papers",
	collections: "collections",
};

/** hf_fs and hf_sandbox_fs: `{operations: [{cmd, args}]}` or a single `{cmd, args}` */
function describeFsOps(args: Record<string, unknown>, where: "Hub" | "sandbox"): Action {
	const ops = Array.isArray(args.operations)
		? (args.operations as Record<string, unknown>[])
		: [args];
	const op = ops[0] ?? {};
	const cmd = asString(op.cmd) ?? asString(op.command) ?? "";
	const { positional, flags } = cliArgs(stringList(op.args));
	const target =
		positional.find((p) => p.startsWith("hf://") || p.startsWith("/")) ?? positional[0];
	const uri = hubUri(target);
	const more = ops.length > 1 ? `+${ops.length - 1} more` : undefined;
	const place = where === "Hub" ? "the Hub" : "the sandbox";
	const name = target ? basename(uri?.path ?? target) : undefined;
	switch (cmd) {
		case "search": {
			const query = positional.find((p) => p !== target) ?? flags.query;
			const scope = uri ? HUB_SCOPES[uri.scope] : undefined;
			const what = where === "Hub" ? (scope ? `Hub ${scope}` : "the Hub") : "sandbox files";
			return {
				kind: "search",
				gerund: `Searching ${what}`,
				past: `Searched ${what}`,
				infinitive: `search ${what}`,
				subject: query,
				detail: more,
				groupKey: `search:${what}`,
				plural: (n) => `ran ${n} searches on ${what}`,
			};
		}
		case "ls":
		case "list":
		case "tree": {
			const listed = shorten(uri?.rest || uri?.path || target || place, 48);
			return {
				kind: "lookup",
				gerund: `Listing ${listed}`,
				past: `Listed ${listed}`,
				infinitive: `list ${listed}`,
				detail: more,
				groupKey: `list:${where}`,
				plural: (n) => `listed ${n} folders`,
			};
		}
		case "cat":
		case "read":
		case "head":
		case "tail":
			return {
				kind: "file",
				gerund: `Reading ${name ?? "a file"}`,
				past: `Read ${name ?? "a file"}`,
				infinitive: `read ${name ?? "a file"}`,
				subject: uri?.path ?? target,
				mono: true,
				detail: more,
				groupKey: `read:${where}`,
				plural: (n) => `read ${n} files`,
			};
		case "stat":
		case "info":
			return {
				kind: "lookup",
				gerund: `Checking ${name ?? place}`,
				past: `Checked ${name ?? place}`,
				infinitive: `check ${name ?? place}`,
				subject: uri?.path ?? target,
				mono: true,
				detail: more,
				groupKey: `stat:${where}`,
				plural: (n) => `checked ${n} files`,
			};
		case "cp":
		case "mv":
		case "rm":
		case "write":
		case "upload":
		case "mkdir": {
			const verbs: Record<string, [string, string, string]> = {
				cp: ["Copying", "Copied", "copy"],
				mv: ["Moving", "Moved", "move"],
				rm: ["Deleting", "Deleted", "delete"],
				write: ["Writing", "Wrote", "write"],
				upload: ["Uploading", "Uploaded", "upload"],
				mkdir: ["Creating", "Created", "create"],
			};
			const [gerund, past, infinitive] = verbs[cmd];
			const object = name ?? "a file";
			return {
				kind: "write",
				gerund: `${gerund} ${object}`,
				past: `${past} ${object}`,
				infinitive: `${infinitive} ${object}`,
				subject: uri?.path ?? target,
				mono: true,
				detail: more,
				groupKey: `write:${where}:${cmd}`,
				plural: (n) => `${lowerFirst(past)} ${n} files`,
			};
		}
		default:
			return {
				kind: "file",
				gerund: `Using ${place} files`,
				past: `Used ${place} files`,
				infinitive: `use ${place} files`,
				subject: target,
				mono: true,
				detail: [cmd, more].filter(Boolean).join(" ") || undefined,
			};
	}
}

/** hf_sandbox: `{cmd, args}`; hf_sandbox_exec: `{args: ["exec", handle, command]}` */
function describeSandbox(name: string, args: Record<string, unknown>): Action {
	const list = stringList(args.args);
	const cmd = asString(args.cmd) ?? (name === "hf_sandbox_exec" ? "exec" : list[0]) ?? "";
	const rest = list[0] === cmd ? list.slice(1) : list;
	const { positional, flags } = cliArgs(rest);
	switch (cmd) {
		case "create":
		case "start":
			return {
				kind: "code",
				gerund: "Starting a sandbox",
				past: "Started a sandbox",
				infinitive: "start a sandbox",
				subject: flags.flavor,
				mono: true,
				groupKey: "sandbox:start",
				plural: (n) => `started ${n} sandboxes`,
			};
		case "exec":
		case "run": {
			const command = positional.find((p) => !p.startsWith("hfsb")) ?? positional.at(-1);
			return {
				kind: "code",
				gerund: "Running a sandbox command",
				past: "Ran a sandbox command",
				infinitive: "run a sandbox command",
				subject: command ? shorten(command.replace(/\s+/g, " "), 120) : undefined,
				mono: true,
				groupKey: "sandbox:exec",
				plural: (n) => `ran ${n} sandbox commands`,
			};
		}
		case "status":
		case "info":
			return {
				kind: "lookup",
				gerund: "Checking the sandbox",
				past: "Checked the sandbox",
				infinitive: "check the sandbox",
				groupKey: "sandbox:status",
				plural: (n) => `checked the sandbox ${n} times`,
			};
		case "stop":
		case "terminate":
		case "delete":
			return {
				kind: "code",
				gerund: "Stopping the sandbox",
				past: "Stopped the sandbox",
				infinitive: "stop the sandbox",
				groupKey: "sandbox:stop",
			};
		default:
			return {
				kind: "code",
				gerund: "Using the sandbox",
				past: "Used the sandbox",
				infinitive: "use the sandbox",
				detail: cmd || undefined,
				groupKey: "sandbox",
				plural: (n) => `used the sandbox ${n} times`,
			};
	}
}

/** hf_jobs: `{operation, args: {command | script | job_id}}` */
function describeJobs(args: Record<string, unknown>): Action {
	const inner = (args.args && typeof args.args === "object" ? args.args : {}) as Record<
		string,
		unknown
	>;
	const operation =
		asString(args.operation) ?? (inner.command || inner.script ? "run" : undefined) ?? "";
	const jobId = asString(inner.job_id) ?? asString(inner.id);
	switch (operation) {
		case "run":
		case "uv":
		case "create": {
			const command = stringList(inner.command).join(" ") || asString(inner.script);
			return {
				kind: "code",
				gerund: "Starting a job",
				past: "Started a job",
				infinitive: "start a job",
				subject: command ? shorten(command.replace(/\s+/g, " "), 120) : undefined,
				mono: true,
				groupKey: "jobs:run",
				plural: (n) => `started ${n} jobs`,
			};
		}
		case "logs":
			return {
				kind: "lookup",
				gerund: "Reading job logs",
				past: "Read job logs",
				infinitive: "read job logs",
				subject: jobId,
				mono: true,
				groupKey: "jobs:logs",
				plural: (n) => `read job logs ${n} times`,
			};
		case "inspect":
		case "ps":
		case "list":
		case "status":
			return {
				kind: "lookup",
				gerund: jobId ? "Checking a job" : "Checking jobs",
				past: jobId ? "Checked a job" : "Checked jobs",
				infinitive: jobId ? "check a job" : "check jobs",
				subject: jobId,
				mono: true,
				groupKey: "jobs:inspect",
				plural: (n) => `checked jobs ${n} times`,
			};
		case "cancel":
			return {
				kind: "other",
				gerund: "Cancelling a job",
				past: "Cancelled a job",
				infinitive: "cancel a job",
				subject: jobId,
				mono: true,
				groupKey: "jobs:cancel",
			};
		default:
			return {
				kind: "other",
				gerund: "Using Hugging Face Jobs",
				past: "Used Hugging Face Jobs",
				infinitive: "use Hugging Face Jobs",
				detail: operation || undefined,
				groupKey: `jobs:${operation}`,
			};
	}
}

/** Built-in tools whose names say little on their own. */
function describeKnown(name: string, args: Record<string, unknown>): Action | undefined {
	const file = firstString(args, ["name", "path", "file"]);
	const short = file ? basename(file) : undefined;
	switch (name) {
		case "hf_fs":
			return describeFsOps(args, "Hub");
		case "hf_sandbox_fs":
			return describeFsOps(args, "sandbox");
		case "hf_sandbox":
		case "hf_sandbox_exec":
			return describeSandbox(name, args);
		case "hf_jobs":
			return describeJobs(args);
		case "read_file":
			return file
				? {
						kind: "file",
						gerund: `Reading ${short}`,
						past: `Read ${short}`,
						infinitive: `read ${short}`,
						subject: file,
						mono: true,
						groupKey: "read_file",
						plural: (n) => `read ${n} files`,
					}
				: {
						kind: "lookup",
						gerund: "Listing files",
						past: "Listed files",
						infinitive: "list files",
						groupKey: "list_files",
					};
		case "write_file":
		case "edit_file":
		case "import_file":
		case "hf_fs_write": {
			const [gerund, past, infinitive] =
				name === "edit_file"
					? ["Editing", "Edited", "edit"]
					: name === "import_file"
						? ["Importing", "Imported", "import"]
						: ["Writing", "Wrote", "write"];
			const object = short ?? "a file";
			return {
				kind: "write",
				gerund: `${gerund} ${object}`,
				past: `${past} ${object}`,
				infinitive: `${infinitive} ${object}`,
				subject: file,
				mono: true,
				groupKey: name,
				plural: (n) => `${lowerFirst(past)} ${n} files`,
			};
		}
		case "check_job":
			return {
				kind: "lookup",
				gerund: "Checking a job",
				past: "Checked a job",
				infinitive: "check a job",
				subject: firstString(args, ["job_id"]),
				mono: true,
				groupKey: "check_job",
				plural: (n) => `checked jobs ${n} times`,
			};
		case "research":
			return {
				kind: "other",
				gerund: "Researching",
				past: "Researched",
				infinitive: "research",
				subject: firstString(args, ["task", "query"]),
				groupKey: "research",
				plural: (n) => `researched ${n} topics`,
			};
		case "sandbox_task":
			return {
				kind: "code",
				gerund: "Running a sandbox task",
				past: "Ran a sandbox task",
				infinitive: "run a sandbox task",
				subject: firstString(args, ["task"]),
				groupKey: "sandbox_task",
				plural: (n) => `ran ${n} sandbox tasks`,
			};
		case "create_trackio":
			return {
				kind: "create",
				gerund: "Creating a Trackio dashboard",
				past: "Created a Trackio dashboard",
				infinitive: "create a Trackio dashboard",
				subject: firstString(args, ["project"]),
			};
		case "hf_whoami":
			return {
				kind: "lookup",
				gerund: "Checking your account",
				past: "Checked your account",
				infinitive: "check your account",
			};
		case "wait":
			return { kind: "other", gerund: "Waiting", past: "Waited", infinitive: "wait" };
		default:
			return undefined;
	}
}

/** What the name patterns can tell about any other tool, e.g. one from an MCP server. */
function describeByKind(name: string, args: Record<string, unknown>): Action {
	const kind = classifyTool(name);
	switch (kind) {
		case "search": {
			const target = searchTarget(name);
			const what = target ? ` ${target}` : "";
			return {
				kind,
				gerund: `Searching${what}`,
				past: `Searched${what}`,
				infinitive: `search${what}`,
				subject: firstString(args, ["query", "q", "search", "text", "keywords"]),
				groupKey: `search:${target ?? ""}`,
				plural: (n) =>
					target === "the web"
						? `ran ${n} web searches`
						: `ran ${n} searches${target ? ` on ${target}` : ""}`,
			};
		}
		case "page": {
			const urls = stringList(args.urls);
			const url = firstString(args, ["url", "urls", "link", "href"]);
			const domain = domainOf(url);
			const object = urls.length > 1 ? `${urls.length} pages` : (domain ?? "a page");
			return {
				kind,
				gerund: `Reading ${object}`,
				past: `Read ${object}`,
				infinitive: `read ${object}`,
				subject:
					urls.length > 1
						? urls
								.map((u) => domainOf(u) ?? u)
								.filter((d, i, all) => all.indexOf(d) === i)
								.join(", ")
						: url,
				mono: urls.length <= 1,
				groupKey: "page",
				plural: (n) => `read ${n} pages`,
			};
		}
		case "code": {
			const python = /python/.test(name.toLowerCase());
			const command = firstString(args, ["command", "cmd"]);
			const code = firstString(args, ["code", "script", "source"]);
			const language = python ? "Python" : "code";
			return {
				kind,
				gerund: `Running ${language}`,
				past: `Ran ${language}`,
				infinitive: `run ${language}`,
				subject: command
					? shorten(command, 120)
					: code
						? `${code.split("\n").length} lines`
						: undefined,
				mono: Boolean(command),
				groupKey: `code:${language}`,
				plural: (n) => `ran ${language} ${n} times`,
			};
		}
		case "create": {
			const repoType = firstString(args, ["repo_type", "type"]);
			const what =
				repoType === "space"
					? "Space"
					: repoType === "dataset"
						? "dataset"
						: repoType === "model"
							? "model repo"
							: humanizeToolName(name.replace(/^create_/, ""));
			const article = /^[aeiou]/i.test(what) ? "an" : "a";
			return {
				kind,
				gerund: `Creating ${article} ${what}`,
				past: `Created ${article} ${what}`,
				infinitive: `create ${article} ${what}`,
				subject: firstString(args, ["repo_id", "name", "id", "title"]),
				mono: true,
				groupKey: `create:${what}`,
				plural: (n) => `created ${n} ${what}s`,
			};
		}
		case "write": {
			const path = firstString(args, ["path_in_repo", "path", "file_path", "filename", "file"]);
			const n = name.toLowerCase();
			const [gerund, past, infinitive] = /upload/.test(n)
				? ["Uploading", "Uploaded", "upload"]
				: /edit|patch/.test(n)
					? ["Editing", "Edited", "edit"]
					: /commit/.test(n)
						? ["Committing", "Committed", "commit"]
						: ["Writing", "Wrote", "write"];
			const object = path ? basename(path) : "a file";
			return {
				kind,
				gerund: `${gerund} ${object}`,
				past: `${past} ${object}`,
				infinitive: `${infinitive} ${object}`,
				subject: path,
				mono: true,
				groupKey: `write:${past}`,
				plural: (count) => `${lowerFirst(past)} ${count} files`,
			};
		}
		case "image":
			return {
				kind,
				gerund: "Generating an image",
				past: "Generated an image",
				infinitive: "generate an image",
				subject: firstString(args, ["prompt", "text"]),
				groupKey: "image",
				plural: (n) => `generated ${n} images`,
			};
		case "lookup": {
			const human = humanizeToolName(name).replace(/^(get|list|read)\s+/, "");
			const [gerund, past, infinitive] = /^list_/.test(name)
				? ["Listing", "Listed", "list"]
				: /^read_/.test(name)
					? ["Reading", "Read", "read"]
					: ["Checking", "Checked", "check"];
			return {
				kind,
				gerund: `${gerund} ${human}`,
				past: `${past} ${human}`,
				infinitive: `${infinitive} ${human}`,
				subject: firstString(args, ["repo_id", "id", "name", "path"]),
				mono: true,
			};
		}
		default: {
			const human = humanizeToolName(name);
			return {
				kind,
				gerund: `Using ${human}`,
				past: `Used ${human}`,
				infinitive: `use ${human}`,
			};
		}
	}
}

const SOFT_FAILURE =
	/^\[[A-Z][A-Z0-9_]*(ERROR|NOT_FOUND|FAILED|FORBIDDEN|DENIED|TIMEOUT|INVALID)[A-Z0-9_]*\]/;

/** "[HF_FS_NOT_FOUND] …" or `{"error": …}` in a successful result: the call did not do its job */
function softFailure(updates: MessageToolUpdate[]): boolean {
	for (const update of updates) {
		if (!isMessageToolResultUpdate(update) || update.result.status !== ToolResultStatus.Success) {
			continue;
		}
		for (const output of update.result.outputs ?? []) {
			const text = typeof output.text === "string" ? output.text.trim() : "";
			if (SOFT_FAILURE.test(text)) return true;
			if (text.startsWith("{")) {
				try {
					const parsed = JSON.parse(text) as Record<string, unknown>;
					if (parsed && typeof parsed === "object" && parsed.error) return true;
				} catch {
					// not JSON: nothing to tell
				}
			}
		}
	}
	return false;
}

export function toolStatus(updates: MessageToolUpdate[], loading: boolean): ToolStatus {
	const failed = updates.some(
		(update) =>
			isMessageToolErrorUpdate(update) ||
			(isMessageToolResultUpdate(update) && update.result.status === ToolResultStatus.Error)
	);
	if (failed || softFailure(updates)) return "error";
	if (updates.some(isMessageToolResultUpdate)) return "done";
	return loading ? "running" : "stopped";
}

export function describeToolActivity(
	updates: MessageToolUpdate[],
	loading: boolean
): ToolActivity | undefined {
	const call = updates.find(isMessageToolCallUpdate);
	if (!call) return undefined;
	const name = call.call.name;
	// subjects are shown on the collapsed row, so they get the same redaction as the tool's input
	const args = redactToolArguments(callArguments(call)) as Record<string, unknown>;
	const status = toolStatus(updates, loading);
	const action = describeKnown(name, args) ?? describeByKind(name, args);
	const verb =
		status === "running"
			? action.gerund
			: status === "error"
				? `Couldn't ${action.infinitive}`
				: status === "stopped"
					? `Stopped ${lowerFirst(action.gerund)}`
					: action.past;
	const phrase = lowerFirst(action.past);
	return {
		name,
		kind: action.kind,
		status,
		verb,
		subject: action.subject,
		mono: action.mono,
		detail: action.detail,
		phrase,
		failPhrase: `couldn't ${action.infinitive}`,
		groupKey: action.groupKey ?? `${name}:${phrase}`,
		plural: action.plural ?? ((count) => `${phrase} ${count} times`),
	};
}

export interface ActivitySummary {
	text: string;
	/** what failed, shown apart so a retry that worked still reads as success */
	failure?: string;
	/** some calls never returned because the turn ended */
	stopped: boolean;
}

function byGroupKey(tools: ToolActivity[]): ToolActivity[][] {
	const groups = new Map<string, ToolActivity[]>();
	for (const tool of tools) groups.set(tool.groupKey, [...(groups.get(tool.groupKey) ?? []), tool]);
	return [...groups.values()];
}

/** "couldn't read lmarena.ai", "couldn't read lmarena.ai ×3", or "3 calls failed" */
function failureText(failed: ToolActivity[]): string | undefined {
	if (failed.length === 0) return undefined;
	const unique = [...new Set(failed.map((t) => t.failPhrase))];
	if (unique.length === 1) return failed.length > 1 ? `${unique[0]} ×${failed.length}` : unique[0];
	return `${failed.length} calls failed`;
}

/**
 * One line for a finished run of calls: "Read 2 pages, searched the web". Failed calls are
 * named apart ("couldn't read lmarena.ai"), and calls with the same target are counted together.
 */
export function summarizeActivity(tools: ToolActivity[]): ActivitySummary {
	const failed = tools.filter((t) => t.status === "error");
	const ok = tools.filter((t) => t.status !== "error");
	const stopped = tools.some((t) => t.status === "stopped");
	if (ok.length === 0) {
		return { text: capFirst(failureText(failed) ?? "Tried a tool"), stopped };
	}
	const parts = byGroupKey(ok).map((list) =>
		list.length === 1 ? list[0].phrase : list[0].plural(list.length)
	);
	let text = parts.slice(0, 3).join(", ");
	if (parts.length > 3) text += `, +${parts.length - 3} more`;
	return { text: capFirst(text), failure: failureText(failed), stopped };
}

type ProcessBlock =
	| { type: "think"; content: string; closed: boolean; round?: number }
	| { type: "tool"; uuid: string; updates: MessageToolUpdate[]; round?: number };

/** a step with something to show: reasoning with text, or a call */
export function isRenderableStep(block: ProcessBlock): boolean {
	return block.type === "think"
		? block.content.trim().length > 0
		: block.updates.some(isMessageToolCallUpdate);
}

/** a run of nothing but a few words of reasoning: not worth a line once it is over */
export function isTrivialThinking(blocks: ProcessBlock[]): boolean {
	let length = 0;
	for (const block of blocks) {
		if (block.type !== "think") return false;
		length += block.content.trim().length;
	}
	return length < 40;
}

/** consecutive identical calls (a polling loop, a retried failure) shown once with a count */
export function collapseSteps<T extends ProcessBlock>(
	blocks: T[],
	loading: boolean
): Array<{ block: T; count: number }> {
	const out: Array<{ block: T; count: number; key?: string }> = [];
	for (const block of blocks) {
		let key: string | undefined;
		if (block.type === "tool") {
			const activity = describeToolActivity(block.updates, loading);
			if (activity) key = `${activity.name}|${activity.verb}|${activity.subject ?? ""}`;
		}
		const last = out.at(-1);
		if (key && last?.key === key) last.count += 1;
		else out.push({ block, count: 1, key });
	}
	return out.map(({ block, count }) => ({ block, count }));
}

/** "Thought for 12s", from a reasoning time */
export function formatThought(ms: number): string {
	if (ms < 1000) return "Thought briefly";
	const seconds = Math.round(ms / 1000);
	if (seconds < 60) return `Thought for ${seconds}s`;
	return `Thought for ${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** The first sentence of some reasoning, for a run nothing else describes. */
export function reasoningPreview(content: string, max = 64): string | undefined {
	let text = content.trim().replace(/\s+/g, " ");
	for (;;) {
		const next = text.replace(
			/^(okay|ok|alright|all right|so|well|hmm+|right|now)\b[,.!:\s]*/i,
			""
		);
		if (next === text) break;
		text = next;
	}
	const sentence = text.split(/(?<=[.!?])\s/)[0]?.replace(/[.:,;]+$/, "");
	if (!sentence) return undefined;
	return capFirst(shorten(sentence, max));
}

export interface ActivityLabels {
	/** the latest live label of each round (thinking progress or calls), with its position */
	latest: Map<number, { text: string; seq: number; phase: "thinking" | "tools" }>;
	/** the latest progress label while each round reasons */
	thinking: Map<number, string>;
	/** each round's reasoning once complete, its row text */
	summary: Map<number, string>;
	/** the latest label of each round's calls */
	tools: Map<number, string>;
	/** how long each round reasoned */
	thinkingMs: Map<number, number>;
}

export function activityLabels(updates: MessageUpdate[] | undefined): ActivityLabels {
	const labels: ActivityLabels = {
		latest: new Map(),
		thinking: new Map(),
		summary: new Map(),
		tools: new Map(),
		thinkingMs: new Map(),
	};
	for (const [seq, update] of (updates ?? []).entries()) {
		if (isMessageActivityTimingUpdate(update)) {
			labels.thinkingMs.set(update.round, update.thinkingMs);
			continue;
		}
		if (!isMessageActivityLabelUpdate(update) || !update.text) continue;
		if (update.phase === "summary") {
			labels.summary.set(update.round, update.text);
			continue;
		}
		labels[update.phase].set(update.round, update.text);
		labels.latest.set(update.round, { text: update.text, seq, phase: update.phase });
	}
	return labels;
}

/** What a thinking step's row (or a run of thinking alone) says once it is over. */
export function thoughtLabel(labels: ActivityLabels, round: number, content: string): string {
	const ms = labels.thinkingMs.get(round);
	return (
		labels.summary.get(round) ??
		labels.thinking.get(round) ??
		(ms !== undefined ? formatThought(ms) : undefined) ??
		reasoningPreview(content) ??
		"Thought"
	);
}
