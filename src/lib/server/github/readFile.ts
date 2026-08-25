import {
	encodePath,
	encodeSegments,
	githubJson,
	githubRequest,
	githubToken,
	MISSING_TOKEN_MESSAGE,
} from "./client";
import { notebookToMarkdown } from "./notebook";
import { parseRepo, repoSlug } from "./repoRef";
import type { GithubToolResult } from "./types";

/**
 * Verbatim source retrieval with a line window. This is where grounding actually
 * happens — the model reads the real imports, the real trainer config, the real
 * dataset plumbing, rather than recalling what they used to be.
 */

/** The window a call with no line arguments gets. */
export const DEFAULT_WINDOW_LINES = 300;

/**
 * Ceilings on a single read, applied at the tool boundary rather than left to
 * whatever trims the context later. A read that gets silently amputated
 * downstream is worse than one that was honestly capped: the model implements
 * against a file it believes it read in full.
 */
export const MAX_WINDOW_LINES = 1500;
export const MAX_WINDOW_CHARS = 80_000;
/** Past this there is no reading to be done, only context to burn. */
const MAX_FETCH_BYTES = 10 * 1024 * 1024;

interface ContentsResponse {
	type?: string;
	content?: string;
	encoding?: string;
	size?: number;
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
	py: "python",
	ipynb: "markdown",
	ts: "typescript",
	tsx: "tsx",
	js: "javascript",
	jsx: "jsx",
	sh: "bash",
	bash: "bash",
	rs: "rust",
	go: "go",
	c: "c",
	h: "c",
	cpp: "cpp",
	cu: "cuda",
	java: "java",
	rb: "ruby",
	json: "json",
	jsonl: "json",
	yaml: "yaml",
	yml: "yaml",
	toml: "toml",
	cfg: "ini",
	ini: "ini",
	md: "markdown",
	mdx: "markdown",
	txt: "text",
	csv: "csv",
	sql: "sql",
	dockerfile: "dockerfile",
};

function languageFor(path: string): string {
	const name = path.split("/").pop() ?? "";
	if (name.toLowerCase() === "dockerfile") return "dockerfile";
	const extension = name.includes(".") ? name.split(".").pop()?.toLowerCase() : undefined;
	return (extension && LANGUAGE_BY_EXTENSION[extension]) || "";
}

/**
 * A fence long enough that the file's own backticks cannot close it early —
 * which matters most for the Markdown a notebook renders to, since that is
 * nothing but fenced blocks.
 */
function fenceFor(body: string): string {
	const longest = [...body.matchAll(/^\s*(`{3,})/gm)].reduce(
		(max, match) => Math.max(max, match[1].length),
		2
	);
	return "`".repeat(Math.max(3, longest + 1));
}

/**
 * Splits into lines without inventing one. A file ending in a newline is not a
 * file with a trailing empty line, and counting it as one made the Python
 * original report a 300-line file as 301 lines and trip its own cap.
 */
export function splitLines(text: string): string[] {
	const body = text.endsWith("\n") ? text.slice(0, -1) : text;
	return body.split("\n");
}

export interface Window {
	start: number;
	end: number;
	cappedBy?: "lines" | "chars";
}

export type WindowResult = { ok: true; window: Window } | { ok: false; message: string };

/**
 * Resolves the requested window against the file, clamping out-of-range bounds
 * rather than refusing them — an end past EOF is an over-estimate, not a mistake
 * worth a failed turn.
 */
export function resolveWindow(
	lines: string[],
	lineStart: number | undefined,
	lineEnd: number | undefined
): WindowResult {
	const total = lines.length;
	if (total === 0) return { ok: true, window: { start: 1, end: 0 } };

	const explicit = lineStart !== undefined || lineEnd !== undefined;
	const start = Math.max(1, lineStart ?? 1);
	let end = Math.min(total, lineEnd ?? (explicit ? total : Math.min(total, DEFAULT_WINDOW_LINES)));

	if (start > total) {
		return {
			ok: false,
			message: `line_start ${start} is past the end of the file, which has ${total} lines.`,
		};
	}
	if (start > end) {
		return {
			ok: false,
			message: `line_start (${lineStart}) is after line_end (${lineEnd}). Give a range that runs forwards.`,
		};
	}

	let cappedBy: Window["cappedBy"];
	if (end - start + 1 > MAX_WINDOW_LINES) {
		end = start + MAX_WINDOW_LINES - 1;
		cappedBy = "lines";
	}
	let chars = 0;
	for (let i = start; i <= end; i++) {
		chars += lines[i - 1].length + 1;
		if (chars > MAX_WINDOW_CHARS) {
			end = Math.max(start, i - 1);
			cappedBy = "chars";
			break;
		}
	}

	return { ok: true, window: { start, end, ...(cappedBy ? { cappedBy } : {}) } };
}

const asOptionalInt = (value: unknown): number | undefined => {
	if (value === undefined || value === null || value === "") return undefined;
	const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
	return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
};

/** Base64 from the contents API arrives wrapped; invalid bytes become replacement characters rather than an error. */
function decodeBase64(content: string): string {
	return Buffer.from(content.replace(/\s/g, ""), "base64").toString("utf8");
}

export async function readFile(
	args: Record<string, unknown>,
	options: { signal?: AbortSignal } = {}
): Promise<GithubToolResult> {
	if (!githubToken()) return { text: MISSING_TOKEN_MESSAGE, isError: true };

	const parsed = parseRepo(args.repo, args.org);
	if (!parsed.ok) return { text: parsed.message, isError: true };
	const slug = repoSlug(parsed.ref);

	const path = typeof args.path === "string" ? args.path.trim().replace(/^\/+/, "") : "";
	if (!path) {
		return {
			text: "`path` is required — the file to read, e.g. 'examples/scripts/sft.py'. Use github_find_examples first if you do not know it.",
			isError: true,
		};
	}

	const ref = typeof args.ref === "string" && args.ref.trim() ? args.ref.trim() : "HEAD";
	const signal = options.signal;
	// Omitted rather than sent as "HEAD": letting GitHub resolve the default branch
	// itself is the same request the API documents, and one less thing to get wrong.
	const query = ref === "HEAD" ? "" : `?ref=${encodeURIComponent(ref)}`;
	const url = `/repos/${encodeSegments(parsed.ref.owner, parsed.ref.repo)}/contents/${encodePath(path)}${query}`;

	const response = await githubJson<ContentsResponse | ContentsResponse[]>(url, { signal });
	if (!response.ok) {
		if (response.status === 404) {
			return {
				text: `File not found: ${path} in ${slug} (ref: ${ref}). Check the path with github_find_examples, or check that the ref exists.`,
				isError: true,
			};
		}
		return { text: response.message, isError: true };
	}

	if (Array.isArray(response.data)) {
		const names = response.data
			.map((entry) => (entry as { name?: string }).name)
			.filter(Boolean)
			.slice(0, 20);
		return {
			text: `${path} in ${slug} is a directory, not a file. It contains: ${names.join(", ")}${names.length === 20 ? ", …" : ""}. Read one of those instead.`,
			isError: true,
		};
	}

	const meta = response.data;
	if (meta.type && meta.type !== "file") {
		return {
			text: `${path} in ${slug} is a ${meta.type}, not a file. Read a file path instead.`,
			isError: true,
		};
	}
	if ((meta.size ?? 0) > MAX_FETCH_BYTES) {
		return {
			text: `${path} in ${slug} is ${(meta.size ?? 0).toLocaleString("en-US")} bytes, too large to read. It is almost certainly data rather than source.`,
			isError: true,
		};
	}

	let text: string;
	if (meta.content && meta.content.trim()) {
		text = decodeBase64(meta.content);
	} else if ((meta.size ?? 0) > 0) {
		// Over roughly 1MB the contents API returns an empty `content` field, and the
		// only way to the bytes is the raw media type. Several HF example notebooks
		// are past that line, so this is a normal path, not a fallback for oddities.
		// `size` is what separates that case from a file that really is empty.
		const raw = await githubRequest(url, { signal, accept: "application/vnd.github.raw" });
		if (!raw.ok) return { text: raw.message, isError: true };
		text = raw.body;
	} else {
		text = "";
	}

	let rendered = text;
	let notebook = false;
	if (path.toLowerCase().endsWith(".ipynb")) {
		const markdown = notebookToMarkdown(text);
		if (markdown !== null) {
			rendered = markdown;
			notebook = true;
		}
		// A notebook that will not parse is returned as its raw JSON: worse to read,
		// but the read still succeeds and still grounds.
	}

	const header = `**${slug} — ${path}**${ref === "HEAD" ? "" : ` (ref: ${ref})`}`;

	// Said plainly rather than rendered as one blank line, which reads as a failed
	// read and invites the model to try again.
	if (!rendered) {
		return { text: `${header}\n\nThe file is empty.`, isError: false };
	}

	const lines = splitLines(rendered);
	const window = resolveWindow(lines, asOptionalInt(args.line_start), asOptionalInt(args.line_end));
	if (!window.ok) return { text: window.message, isError: true };

	const { start, end, cappedBy } = window.window;
	let body = lines.slice(start - 1, end).join("\n");

	// The window is line-granular, so a line longer than the whole budget survives
	// it: a minified or generated file is one line and can run to megabytes, which
	// would defeat the cap entirely and can push the next completion past its
	// context. The cap is a promise about output size, so it is enforced on the
	// text rather than on the line count.
	const cutMidLine = body.length > MAX_WINDOW_CHARS;
	if (cutMidLine) body = body.slice(0, MAX_WINDOW_CHARS);

	const fence = fenceFor(body);
	const language = notebook ? "markdown" : languageFor(path);

	// Always stated, for an explicit range as much as for the default one. Reporting
	// the total only on the implicit window let a model ask for lines 1–500 of an
	// 812-line file and never learn that 312 lines existed beyond its view.
	const footer: string[] = [];
	if (start === 1 && end === lines.length) {
		footer.push(`Showing all ${lines.length} line${lines.length === 1 ? "" : "s"}.`);
	} else {
		footer.push(
			`Showing lines ${start}-${end} of ${lines.length}. Use line_start and line_end to read the rest.`
		);
	}
	if (cutMidLine) {
		footer.push(
			`Line ${start} is longer than the ${MAX_WINDOW_CHARS.toLocaleString("en-US")} character limit for one read and was cut mid-line, so what you see above is incomplete.`
		);
	} else if (cappedBy === "lines") {
		footer.push(`The requested range was capped at ${MAX_WINDOW_LINES} lines per read.`);
	} else if (cappedBy === "chars") {
		footer.push(
			`The requested range was capped at roughly ${MAX_WINDOW_CHARS.toLocaleString("en-US")} characters per read.`
		);
	}
	if (notebook) {
		footer.push(
			"This notebook was converted to Markdown with its outputs stripped, so these line numbers index the conversion, not the .ipynb JSON."
		);
	}

	return {
		text: `${header}\n\n${fence}${language}\n${body}\n${fence}\n\n${footer.join(" ")}`,
		isError: false,
	};
}
