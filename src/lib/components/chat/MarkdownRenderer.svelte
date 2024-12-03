<script lang="ts">
	import type { WebSearchSource } from "$lib/types/WebSearch";
	import katex from "katex";
	import DOMPurify from "isomorphic-dompurify";
	import { Marked } from "marked";
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

	const marked = new Marked({
		hooks: {
			preprocess: (md) => addInlineCitations(escapeHTML(md), sources),
			postprocess: (html) => {
				return DOMPurify.sanitize(processLatex(html));
			},
		},
		renderer: {
			codespan: (code) => `<code>${code.replaceAll("&amp;", "&")}</code>`,
			link: (href, title, text) =>
				`<a href="${href?.replace(/>$/, "")}" target="_blank" rel="noreferrer">${text}</a>`,
		},
		gfm: true,
	});

	DOMPurify.addHook("afterSanitizeAttributes", (node) => {
		if (node.tagName === "A") {
			node.setAttribute("rel", "noreferrer");
			node.setAttribute("target", "_blank");
		}
	});
</script>

{#each marked.lexer(content) as token}
	{#if token.type === "code"}
		<CodeBlock lang={token.lang} code={token.text} />
	{:else}
		{#await marked.parse(token.raw) then parsed}
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			{@html parsed}
		{/await}
	{/if}
{/each}

<style lang="postcss">
	:global(.katex-display) {
		overflow: auto hidden;
	}
</style>
