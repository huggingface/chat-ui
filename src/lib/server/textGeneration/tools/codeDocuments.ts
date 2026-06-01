import { parseCodeFenceInfo } from "$lib/utils/codeFence";
import type { EndpointMessage } from "$lib/server/endpoints/endpoints";

export interface CodeDoc {
	/** filename/path written on the code fence, if any */
	path?: string;
	/** language id from the fence (may be empty) */
	language: string;
	/** code contents (without the surrounding fences) */
	content: string;
}

const OPEN_FENCE_RE = /^(\s{0,3})(`{3,}|~{3,})(.*)$/;

/**
 * Extract fenced code blocks from a markdown string. This is a small, dependency-free
 * scanner: the browser markdown pipeline isn't available server-side, and we only need
 * the raw block contents plus the language/path written on the opening fence.
 */
export function extractCodeBlocks(markdown: string): CodeDoc[] {
	if (!markdown) return [];
	const lines = markdown.split("\n");
	const blocks: CodeDoc[] = [];

	for (let i = 0; i < lines.length; ) {
		const open = lines[i].match(OPEN_FENCE_RE);
		if (!open) {
			i += 1;
			continue;
		}

		const indent = open[1].length;
		const fence = open[2];
		const fenceChar = fence[0];
		const fenceLen = fence.length;
		const info = open[3] ?? "";

		// A valid opening info string can't contain the fence character.
		if (info.includes(fenceChar)) {
			i += 1;
			continue;
		}

		const { language, filename } = parseCodeFenceInfo(info);
		const closeRe = new RegExp(`^\\s{0,3}${fenceChar}{${fenceLen},}\\s*$`);
		const contentLines: string[] = [];
		let j = i + 1;
		let closed = false;
		for (; j < lines.length; j += 1) {
			if (closeRe.test(lines[j])) {
				closed = true;
				break;
			}
			contentLines.push(lines[j]);
		}

		const stripIndent = indent > 0 ? new RegExp(`^\\s{0,${indent}}`) : undefined;
		const content = contentLines
			.map((line) => (stripIndent ? line.replace(stripIndent, "") : line))
			.join("\n");

		blocks.push({ path: filename, language, content });
		i = closed ? j + 1 : j;
	}

	return blocks;
}

function normalizeKey(path: string): string {
	return path.trim().replace(/^\.\//, "").toLowerCase();
}

function basename(path: string): string {
	const parts = path.split(/[\\/]/);
	return parts[parts.length - 1] ?? path;
}

/**
 * Tracks the latest known content of each addressable code block in a conversation so
 * the `edit` tool can apply targeted replacements without the model retyping the block.
 *
 * State is reconstructed each turn from the transcript (assistant message content), and
 * mutated in place as edits are applied within a turn.
 */
export class CodeDocState {
	private byPath = new Map<string, CodeDoc>();
	private mostRecent: CodeDoc | undefined;

	static fromMessages(messages: Pick<EndpointMessage, "from" | "content">[]): CodeDocState {
		const state = new CodeDocState();
		for (const message of messages) {
			if (message.from !== "assistant") continue;
			for (const block of extractCodeBlocks(message.content ?? "")) {
				state.record(block);
			}
		}
		return state;
	}

	/** Record a (possibly updated) code block as the latest known version. */
	record(block: CodeDoc): void {
		if (block.path && block.path.trim().length > 0) {
			this.byPath.set(normalizeKey(block.path), { ...block });
		}
		this.mostRecent = { ...block };
	}

	/** Resolve which code block an edit refers to (by path, else the most recent one). */
	lookup(path?: string): CodeDoc | undefined {
		if (path && path.trim().length > 0) {
			const key = normalizeKey(path);
			const exact = this.byPath.get(key);
			if (exact) return exact;

			const entries = [...this.byPath.entries()];
			const byBase = entries.filter(([k]) => basename(k) === basename(key));
			if (byBase.length === 1) return byBase[0][1];
			const bySuffix = entries.filter(([k]) => k.endsWith(key) || key.endsWith(k));
			if (bySuffix.length === 1) return bySuffix[0][1];
			return undefined;
		}
		return this.mostRecent;
	}

	/** Paths of all labeled code blocks (for error messages). */
	knownPaths(): string[] {
		const paths: string[] = [];
		for (const doc of this.byPath.values()) {
			if (doc.path) paths.push(doc.path);
		}
		return paths;
	}

	hasAny(): boolean {
		return this.mostRecent !== undefined;
	}
}
