import type { Message } from "$lib/types/Message";

/**
 * Artifacts: substantial, self-contained pieces of content (apps, documents,
 * components, diagrams) that the model emits inside <artifact> tags. They are
 * rendered in a dedicated side panel with live preview, next to the chat.
 *
 * Two operations exist:
 * - create/rewrite: `<artifact identifier="id" type="html" title="...">full content</artifact>`
 * - update: `<artifact identifier="id" type="update">` containing
 *   `<old_str>…</old_str><new_str>…</new_str>` pairs applied as exact,
 *   first-occurrence string replacements on the latest version. This lets the
 *   model make targeted edits without re-emitting the whole artifact.
 *
 * Every operation produces a new version, so the panel can navigate history.
 * Parsing is streaming-safe: unterminated tags yield `closed: false` blocks
 * whose content grows as tokens arrive, and partially-received tags are kept
 * out of the rendered markdown.
 */

export type ArtifactKind = "html" | "svg" | "code" | "markdown" | "react" | "mermaid";

const KIND_ALIASES: Record<string, ArtifactKind> = {
	html: "html",
	"text/html": "html",
	svg: "svg",
	"image/svg+xml": "svg",
	code: "code",
	"application/vnd.ant.code": "code",
	markdown: "markdown",
	md: "markdown",
	"text/markdown": "markdown",
	react: "react",
	jsx: "react",
	tsx: "react",
	"application/vnd.ant.react": "react",
	mermaid: "mermaid",
	"application/vnd.ant.mermaid": "mermaid",
};

export function normalizeArtifactKind(type: string | undefined): ArtifactKind {
	if (!type) return "code";
	return KIND_ALIASES[type.trim().toLowerCase()] ?? "code";
}

export function isPreviewableKind(kind: ArtifactKind): boolean {
	return kind !== "code";
}

export interface ArtifactUpdatePair {
	old: string;
	new: string;
}

export interface ArtifactCreateOp {
	kind: "create";
	identifier: string;
	type: ArtifactKind;
	title: string;
	language?: string;
	content: string;
	closed: boolean;
}

export interface ArtifactUpdateOp {
	kind: "update";
	identifier: string;
	title?: string;
	pairs: ArtifactUpdatePair[];
	closed: boolean;
}

export type ArtifactOperation = ArtifactCreateOp | ArtifactUpdateOp;

export type ArtifactSegment =
	| { type: "text"; content: string }
	| { type: "artifact"; op: ArtifactOperation };

const OPEN_TAG_REGEX = /<artifact\b([^>]*)>/i;
const CLOSE_TAG = "</artifact>";
const UPDATE_PAIR_REGEX = /<old_str>([\s\S]*?)<\/old_str>\s*<new_str>([\s\S]*?)<\/new_str>/g;

function parseAttributes(raw: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	const attrRegex = /([\w-]+)\s*=\s*"([^"]*)"/g;
	let match: RegExpExecArray | null;
	while ((match = attrRegex.exec(raw)) !== null) {
		attrs[match[1].toLowerCase()] = match[2];
	}
	return attrs;
}

/**
 * If `text` ends with a partial occurrence of `tag` (e.g. "<artifa" for
 * "<artifact"), return the index where that partial starts, otherwise -1.
 * Used to hide tags that are still streaming in token by token.
 */
function partialTagStart(text: string, tag: string): number {
	const lastOpen = text.lastIndexOf("<");
	if (lastOpen === -1) return -1;
	const tail = text.slice(lastOpen);
	if (tail.length >= tag.length) return -1;
	return tag.toLowerCase().startsWith(tail.toLowerCase()) ? lastOpen : -1;
}

/** Strip a trailing, partially-streamed `</artifact` fragment from content. */
function trimPartialCloseTag(content: string): string {
	const idx = partialTagStart(content, CLOSE_TAG);
	return idx === -1 ? content : content.slice(0, idx);
}

function parseUpdatePairs(inner: string): ArtifactUpdatePair[] {
	const pairs: ArtifactUpdatePair[] = [];
	UPDATE_PAIR_REGEX.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = UPDATE_PAIR_REGEX.exec(inner)) !== null) {
		pairs.push({ old: match[1], new: match[2] });
	}
	return pairs;
}

function buildOperation(attrs: Record<string, string>, inner: string, closed: boolean) {
	const identifier = attrs.identifier || attrs.id || "untitled-artifact";
	const rawType = (attrs.type ?? "").trim().toLowerCase();
	if (rawType === "update") {
		return {
			kind: "update" as const,
			identifier,
			title: attrs.title || undefined,
			pairs: parseUpdatePairs(inner),
			closed,
		};
	}
	// Tolerate a single leading/trailing newline so models can format tags on their own lines
	let content = (closed ? inner : trimPartialCloseTag(inner)).replace(/^\r?\n/, "");
	if (closed) content = content.replace(/\r?\n[ \t]*$/, "");
	return {
		kind: "create" as const,
		identifier,
		type: normalizeArtifactKind(rawType),
		title: attrs.title || identifier,
		language: attrs.language || undefined,
		content,
		closed,
	};
}

/**
 * Split raw message text into plain-text and artifact segments.
 * Streaming-safe: an unterminated artifact yields a `closed: false` op, and a
 * partially-received opening tag at the very end of the text is hidden.
 */
export function splitArtifactSegments(text: string): ArtifactSegment[] {
	const segments: ArtifactSegment[] = [];
	let cursor = 0;

	const pushText = (content: string) => {
		if (content.length > 0) segments.push({ type: "text", content });
	};

	while (cursor < text.length) {
		const remaining = text.slice(cursor);
		const openMatch = OPEN_TAG_REGEX.exec(remaining);
		if (!openMatch) {
			// Hide a trailing partially-streamed opening tag (e.g. "<artifact iden…")
			const partialAttr = remaining.search(/<artifact\b[^>]*$/i);
			if (partialAttr !== -1) {
				pushText(remaining.slice(0, partialAttr));
			} else {
				const partial = partialTagStart(remaining, "<artifact");
				pushText(partial === -1 ? remaining : remaining.slice(0, partial));
			}
			break;
		}

		pushText(remaining.slice(0, openMatch.index));

		const attrs = parseAttributes(openMatch[1]);
		const contentStart = openMatch.index + openMatch[0].length;
		const closeIdx = remaining.toLowerCase().indexOf(CLOSE_TAG, contentStart);

		if (closeIdx === -1) {
			// Still streaming: everything after the opening tag belongs to the artifact
			const inner = remaining.slice(contentStart);
			segments.push({ type: "artifact", op: buildOperation(attrs, inner, false) });
			break;
		}

		const inner = remaining.slice(contentStart, closeIdx);
		segments.push({ type: "artifact", op: buildOperation(attrs, inner, true) });
		cursor += closeIdx + CLOSE_TAG.length;
	}

	return segments;
}

export interface ApplyUpdateResult {
	content: string;
	applied: number;
	failed: number;
}

/**
 * Apply find/replace pairs to a base version. Each `old` string must match
 * exactly; only the first occurrence is replaced. Failed pairs are skipped so
 * one bad match doesn't void the rest of the edit.
 */
export function applyArtifactUpdate(base: string, pairs: ArtifactUpdatePair[]): ApplyUpdateResult {
	let content = base;
	let applied = 0;
	let failed = 0;
	for (const pair of pairs) {
		if (pair.old.length === 0) {
			failed += 1;
			continue;
		}
		const idx = content.indexOf(pair.old);
		if (idx === -1) {
			failed += 1;
			continue;
		}
		content = content.slice(0, idx) + pair.new + content.slice(idx + pair.old.length);
		applied += 1;
	}
	return { content, applied, failed };
}

export type ArtifactOpLabel = "create" | "rewrite" | "update";

export interface ArtifactVersion {
	identifier: string;
	type: ArtifactKind;
	title: string;
	language?: string;
	content: string;
	complete: boolean;
	op: ArtifactOpLabel;
	/** 1-based version number within the artifact */
	version: number;
	messageId: Message["id"];
	/** For updates: number of find/replace pairs that did not match */
	failedPairs?: number;
}

export interface Artifact {
	identifier: string;
	versions: ArtifactVersion[];
}

export interface ArtifactCardRef {
	identifier: string;
	/** 1-based version this card points at; -1 when the op couldn't be applied */
	version: number;
}

export interface ArtifactRegistry {
	artifacts: Map<string, Artifact>;
	/** Lookup for inline cards, keyed by `${messageId}:${opIndexWithinMessage}` */
	byMessageOp: Map<string, ArtifactCardRef>;
	/** The artifact version currently being streamed, if any */
	streaming?: ArtifactCardRef;
}

export function artifactOpKey(messageId: Message["id"], opIndex: number): string {
	return `${messageId}:${opIndex}`;
}

/**
 * Walk the active conversation path and fold artifact operations into
 * versioned artifacts. Updates apply onto the latest version of the same
 * identifier; re-emitting a known identifier counts as a rewrite.
 */
export function collectArtifacts(
	messages: Array<Pick<Message, "id" | "from" | "content">>
): ArtifactRegistry {
	const artifacts = new Map<string, Artifact>();
	const byMessageOp = new Map<string, ArtifactCardRef>();
	let streaming: ArtifactCardRef | undefined;

	for (const message of messages) {
		if (message.from !== "assistant" || !message.content.includes("<artifact")) continue;

		let opIndex = 0;
		for (const segment of splitArtifactSegments(message.content)) {
			if (segment.type !== "artifact") continue;
			const op = segment.op;
			const key = artifactOpKey(message.id, opIndex);
			opIndex += 1;

			let artifact = artifacts.get(op.identifier);

			if (op.kind === "create") {
				if (!artifact) {
					artifact = { identifier: op.identifier, versions: [] };
					artifacts.set(op.identifier, artifact);
				}
				const version: ArtifactVersion = {
					identifier: op.identifier,
					type: op.type,
					title: op.title,
					language: op.language,
					content: op.content,
					complete: op.closed,
					op: artifact.versions.length > 0 ? "rewrite" : "create",
					version: artifact.versions.length + 1,
					messageId: message.id,
				};
				artifact.versions.push(version);
				byMessageOp.set(key, { identifier: op.identifier, version: version.version });
				if (!op.closed) {
					streaming = { identifier: op.identifier, version: version.version };
				}
				continue;
			}

			// update op
			const base = artifact?.versions.at(-1);
			if (!artifact || !base) {
				// Update referencing an unknown artifact: surface a disabled card
				byMessageOp.set(key, { identifier: op.identifier, version: -1 });
				continue;
			}
			const result = applyArtifactUpdate(base.content, op.pairs);
			const version: ArtifactVersion = {
				identifier: op.identifier,
				type: base.type,
				title: op.title || base.title,
				language: base.language,
				content: result.content,
				complete: op.closed,
				op: "update",
				version: artifact.versions.length + 1,
				messageId: message.id,
				failedPairs: result.failed,
			};
			artifact.versions.push(version);
			byMessageOp.set(key, { identifier: op.identifier, version: version.version });
			if (!op.closed) {
				streaming = { identifier: op.identifier, version: version.version };
			}
		}
	}

	return { artifacts, byMessageOp, streaming };
}

/** Remove artifact blocks from text (used for clipboard copies of messages). */
export function stripArtifacts(text: string): string {
	if (!text.includes("<artifact")) return text;
	return splitArtifactSegments(text)
		.filter((segment) => segment.type === "text")
		.map((segment) => (segment.type === "text" ? segment.content : ""))
		.join("")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

const CODE_LANGUAGE_EXTENSIONS: Record<string, string> = {
	python: "py",
	javascript: "js",
	typescript: "ts",
	java: "java",
	c: "c",
	cpp: "cpp",
	"c++": "cpp",
	csharp: "cs",
	go: "go",
	rust: "rs",
	ruby: "rb",
	php: "php",
	swift: "swift",
	kotlin: "kt",
	bash: "sh",
	shell: "sh",
	sql: "sql",
	json: "json",
	yaml: "yaml",
	css: "css",
	scss: "scss",
	html: "html",
};

export function artifactFileName(version: ArtifactVersion): string {
	const ext = (() => {
		switch (version.type) {
			case "html":
				return "html";
			case "svg":
				return "svg";
			case "markdown":
				return "md";
			case "mermaid":
				return "mmd";
			case "react":
				return "jsx";
			case "code":
				return CODE_LANGUAGE_EXTENSIONS[version.language?.toLowerCase() ?? ""] ?? "txt";
		}
	})();
	return `${version.identifier}.${ext}`;
}
