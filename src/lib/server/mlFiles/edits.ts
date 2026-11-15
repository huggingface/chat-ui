import { findMatch } from "$lib/utils/artifacts";
import { diffLines } from "$lib/utils/artifactDiff";

/**
 * the matcher comes from the artifact panel, models miscount indentation and swap
 * typography and an exact only match refuses most edits for a reason the model cannot see
 */

export interface FileEdit {
	old: string;
	new: string;
}

export type ApplyFileEditsResult =
	| { ok: true; content: string }
	/** index is 0 based, nothing was applied */
	| { ok: false; index: number; reason: "empty" | "no_match" };

/** all or nothing, each pair replaces the first occurrence in the output of the previous one */
export function applyFileEdits(content: string, edits: FileEdit[]): ApplyFileEditsResult {
	let working = content;
	for (const [index, edit] of edits.entries()) {
		if (edit.old.length === 0) return { ok: false, index, reason: "empty" };
		const match = findMatch(working, edit.old);
		if (!match) return { ok: false, index, reason: "no_match" };
		working = working.slice(0, match.start) + edit.new + working.slice(match.end);
	}
	return { ok: true, content: working };
}

const CHANGE_SUMMARY_MAX_CHARS = 2_000;

/** the changed hunks as a short unified diff, line numbers match what read_file prints */
export function summarizeChanges(before: string, after: string): string {
	const lines = diffLines(before, after);
	const out: string[] = [];
	let oldLine = 1;
	let newLine = 1;
	let index = 0;
	let length = 0;
	let truncated = false;
	while (index < lines.length) {
		if (lines[index].type === "context") {
			oldLine += 1;
			newLine += 1;
			index += 1;
			continue;
		}
		const hunk: string[] = [];
		const oldStart = oldLine;
		const newStart = newLine;
		let removed = 0;
		let added = 0;
		while (index < lines.length && lines[index].type !== "context") {
			const line = lines[index];
			if (line.type === "del") {
				hunk.push(`-${line.text}`);
				removed += 1;
				oldLine += 1;
			} else {
				hunk.push(`+${line.text}`);
				added += 1;
				newLine += 1;
			}
			index += 1;
		}
		const header = `@@ -${oldStart},${removed} +${newStart},${added} @@`;
		const block = [header, ...hunk].join("\n");
		if (length + block.length + 1 > CHANGE_SUMMARY_MAX_CHARS) {
			truncated = true;
			break;
		}
		out.push(block);
		length += block.length + 1;
	}
	if (truncated) out.push("… (further hunks omitted; read_file shows the result)");
	return out.join("\n");
}
