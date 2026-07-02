// Dependency-free subset of the markdown pipeline.
//
// Everything importable from the main-thread entry chunks (MarkdownRenderer,
// the worker pool, ArtifactPanel) must come from here: the rich pipeline in
// ./marked.ts pulls in KaTeX + highlight.js (~700KB decoded), which must only
// ever load inside the markdown worker or through a dynamic import().

export type CodeToken = {
	type: "code";
	lang: string;
	code: string;
	rawCode: string;
	isClosed: boolean;
};

export type TextToken = {
	type: "text";
	html: string | Promise<string>;
};

export type Token = CodeToken | TextToken;

export type BlockToken = {
	id: string;
	content: string;
	tokens: Token[];
};

export function escapeHTML(content: string) {
	return content.replace(
		/[<>&"']/g,
		(x) =>
			({
				"<": "&lt;",
				">": "&gt;",
				"&": "&amp;",
				"'": "&#39;",
				'"': "&quot;",
			})[x] || x
	);
}

/**
 * Cheap, allocation-light blocks used for SSR and the initial client render.
 *
 * Rich markdown rendering (marked + highlight.js + KaTeX + DOMPurify/jsdom) is
 * intentionally NOT run here: it executes synchronously on the single Node event loop
 * during SSR and, summed across every message of a conversation, can block the loop
 * long enough to fail liveness/readiness health checks (observed event-loop stalls up
 * to ~1.5s). The browser upgrades each message to fully rendered markdown via the
 * markdown worker (or async processBlocks fallback) on mount.
 *
 * The output is deterministic and identical on server and client, so hydration is not
 * affected; only the first paint shows lightly-formatted text before the worker result
 * arrives.
 */
export function fallbackBlocks(content: string): BlockToken[] {
	// Static id: it is only used as the {#each} key for this single throwaway block and
	// has no semantic meaning, so there is no need to hash the (potentially large) content.
	return [
		{
			id: "fallback",
			content,
			tokens: [
				{
					type: "text",
					html: `<div style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeHTML(content)}</div>`,
				},
			],
		},
	];
}
