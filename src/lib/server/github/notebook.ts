/**
 * `.ipynb` → Markdown, for reading notebooks as source.
 *
 * Outputs are dropped outright. They are the bulk of a notebook's bytes and none
 * of its value here: the point of reading a notebook is to see which imports and
 * which trainer arguments currently work, and a serialised tensor repr or a
 * base64 PNG answers neither question while crowding out the code that does.
 *
 * Conversion never fails the read. Anything malformed falls back to the raw JSON,
 * which is worse to read but still grounds better than nothing.
 */

/** nbformat lets `source` be a string or a list of lines; both mean one cell body. */
function cellSource(source: unknown): string {
	if (typeof source === "string") return source;
	if (Array.isArray(source)) return source.filter((line) => typeof line === "string").join("");
	return "";
}

/** Tags authors use to mark a cell as scaffolding rather than content. */
const HIDDEN_TAGS = new Set(["hide", "hidden", "remove"]);

function isHidden(metadata: unknown): boolean {
	const tags = (metadata as { tags?: unknown } | null)?.tags;
	if (!Array.isArray(tags)) return false;
	return tags.some((tag) => typeof tag === "string" && HIDDEN_TAGS.has(tag.trim().toLowerCase()));
}

function notebookLanguage(notebook: Record<string, unknown>): string {
	const metadata = (notebook.metadata ?? {}) as Record<string, unknown>;
	const info = (metadata.language_info ?? {}) as { name?: unknown };
	const kernel = (metadata.kernelspec ?? {}) as { language?: unknown };
	const name = typeof info.name === "string" ? info.name : kernel.language;
	return typeof name === "string" && name.trim() ? name.trim().toLowerCase() : "python";
}

/**
 * A fence long enough to survive a body that itself contains one, so a cell with
 * an embedded ``` block does not terminate the fence early.
 */
function fence(body: string): string {
	const longest = [...body.matchAll(/^\s*(`{3,})/gm)].reduce(
		(max, match) => Math.max(max, match[1].length),
		2
	);
	return "`".repeat(Math.max(3, longest + 1));
}

/** `null` when the input is not a notebook this can render, which is the caller's cue to keep the raw text. */
export function notebookToMarkdown(raw: string): string | null {
	let notebook: Record<string, unknown>;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
		notebook = parsed as Record<string, unknown>;
	} catch {
		return null;
	}

	const cells = notebook.cells;
	if (!Array.isArray(cells)) return null;

	const language = notebookLanguage(notebook);
	const blocks: string[] = [];

	for (const raw of cells) {
		if (typeof raw !== "object" || raw === null) continue;
		const cell = raw as Record<string, unknown>;
		if (isHidden(cell.metadata)) continue;

		const body = cellSource(cell.source).replace(/\s+$/, "");
		if (!body) continue;

		if (cell.cell_type === "markdown") {
			blocks.push(body);
		} else if (cell.cell_type === "code") {
			const ticks = fence(body);
			blocks.push(`${ticks}${language}\n${body}\n${ticks}`);
		} else {
			const ticks = fence(body);
			blocks.push(`${ticks}\n${body}\n${ticks}`);
		}
	}

	return blocks.join("\n\n");
}
