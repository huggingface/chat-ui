<script lang="ts">
	import type { WebSearchSource } from "$lib/types/WebSearch";
	import katex from "katex";
	import DOMPurify from "isomorphic-dompurify";
	import { marked, type MarkedOptions } from "marked";
	import CodeBlock from "../CodeBlock.svelte";

	export let content: string;
	export let sources: WebSearchSource[] = [];

	function addInlineCitations(md: string, webSearchSources: WebSearchSource[] = []): string {
		const linkStyle =
			"color: rgb(59, 130, 246); text-decoration: none; hover:text-decoration: underline;";

		return md.replace(/\[(\d+)\]/g, (match: string) => {
			const indices: number[] = (match.match(/\d+/g) || []).map(Number);
			const links: string = indices
				.map((index: number) => {
					if (index === 0) return false;
					const source = webSearchSources[index - 1];
					if (source) {
						return `<a href="${source.link}" target="_blank" rel="noreferrer" style="${linkStyle}">${index}</a>`;
					}
					return "";
				})
				.filter(Boolean)
				.join(", ");

			return links ? ` <sup>${links}</sup>` : match;
		});
	}

	const renderer = new marked.Renderer();

	// For code blocks with simple backticks
	renderer.codespan = (code) => {
		// Unsanitize double-sanitized code
		return `<code>${code.replaceAll("&amp;", "&")}</code>`;
	};

	renderer.link = (href, title, text) => {
		return `<a href="${href?.replace(/>$/, "")}" target="_blank" rel="noreferrer">${text}</a>`;
	};

	const options: MarkedOptions = {
		gfm: true,
		// breaks: true,
		renderer,
	};

	function escapeHTML(content: string) {
		return content.replace(
			/[<>&\n]/g,
			(x) =>
				({
					"<": "&lt;",
					">": "&gt;",
					"&": "&amp;",
				}[x] || x)
		);
	}

	$: tokens = marked.lexer(addInlineCitations(content, sources));

	function processLatex(parsed: string) {
		const delimiters = [
			{ left: "$$", right: "$$", display: true },
			{ left: "$", right: "$", display: false },
			{ left: "\\(", right: "\\)", display: false },
			{ left: "\\[", right: "\\]", display: true },
		];

		for (const { left, right, display } of delimiters) {
			// Escape special regex characters in the delimiters
			const escapedLeft = left.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			const escapedRight = right.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

			// Create regex pattern that matches content between delimiters
			const pattern = new RegExp(`${escapedLeft}([^]*?)${escapedRight}`, "g");

			parsed = parsed.replace(pattern, (match, latex) => {
				try {
					// Remove the delimiters from the latex content
					const cleanLatex = latex.trim();
					const rendered = katex.renderToString(cleanLatex, { displayMode: display });

					// For display mode, wrap in centered paragraph
					if (display) {
						return `<p style="width:100%;text-align:center;">${rendered}</p>`;
					}
					return rendered;
				} catch (error) {
					console.error("KaTeX error:", error);
					return match; // Return original on error
				}
			});
		}
		return parsed;
	}

	DOMPurify.addHook("afterSanitizeAttributes", (node) => {
		if (node.tagName === "A") {
			node.setAttribute("rel", "noreferrer");
			node.setAttribute("target", "_blank");
		}
	});
</script>

<div
	class="prose max-w-none dark:prose-invert max-sm:prose-sm prose-headings:font-semibold prose-h1:text-lg prose-h2:text-base prose-h3:text-base prose-pre:bg-gray-800 dark:prose-pre:bg-gray-900"
>
	{#each tokens as token}
		{#if token.type === "code"}
			<CodeBlock lang={token.lang} code={token.text} />
		{:else}
			{@const parsed = marked.parse(processLatex(escapeHTML(token.raw)), options)}
			{#await parsed then parsed}
				<!-- eslint-disable-next-line svelte/no-at-html-tags -->
				{@html DOMPurify.sanitize(parsed)}
			{/await}
		{/if}
	{/each}
</div>
