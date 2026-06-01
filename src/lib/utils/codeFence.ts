// Shared parsing of a fenced code block's "info string" (the text right after the
// opening ``` / ~~~). In addition to the language, we support an optional filename/path
// so the model can label code blocks (e.g. ```python app.py) and later edit them by name.

const EXT_TO_LANGUAGE: Record<string, string> = {
	js: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	jsx: "javascript",
	ts: "typescript",
	tsx: "typescript",
	py: "python",
	go: "go",
	rs: "rust",
	java: "java",
	c: "c",
	h: "c",
	cpp: "cpp",
	cc: "cpp",
	cxx: "cpp",
	hpp: "cpp",
	cs: "csharp",
	css: "css",
	scss: "scss",
	sass: "scss",
	html: "html",
	htm: "html",
	xml: "xml",
	svg: "xml",
	json: "json",
	yaml: "yaml",
	yml: "yaml",
	sql: "sql",
	sh: "bash",
	bash: "bash",
	zsh: "bash",
	md: "markdown",
	markdown: "markdown",
};

/** Best-effort mapping from a filename to a highlight.js language id (empty if unknown). */
export function languageFromFilename(filename: string): string {
	const dot = filename.lastIndexOf(".");
	if (dot === -1 || dot === filename.length - 1) return "";
	const ext = filename.slice(dot + 1).toLowerCase();
	return EXT_TO_LANGUAGE[ext] ?? "";
}

// A token looks like a filename/path when it has no whitespace and either contains a
// path separator or ends with a dotted extension. This keeps ordinary language tags
// (```python, ```diff, ```mermaid) from being mistaken for filenames.
const FILENAME_LIKE = /^[\w./\\@+-]+$/;
function looksLikeFilename(token: string): boolean {
	if (!token || !FILENAME_LIKE.test(token)) return false;
	return token.includes("/") || token.includes("\\") || /\.[A-Za-z0-9]+$/.test(token);
}

export interface ParsedCodeFenceInfo {
	language: string;
	filename?: string;
}

/** Parse a code fence info string into a language and an optional filename/path. */
export function parseCodeFenceInfo(info: string | undefined | null): ParsedCodeFenceInfo {
	const trimmed = (info ?? "").trim();
	if (!trimmed) return { language: "" };

	const match = trimmed.match(/^(\S+)(?:\s+(.*))?$/);
	if (!match) return { language: "" };
	const first = match[1];
	const rest = (match[2] ?? "").trim();

	if (rest) {
		// "language filename" — only treat the remainder as a filename if it looks like one,
		// otherwise it's a descriptive label we ignore (keeping just the language).
		if (looksLikeFilename(rest)) {
			return { language: first, filename: rest };
		}
		return { language: first };
	}

	// Single token: either a bare language (```python) or a bare filename (```app.py).
	if (looksLikeFilename(first)) {
		return { language: languageFromFilename(first), filename: first };
	}
	return { language: first };
}
