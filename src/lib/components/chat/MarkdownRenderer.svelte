<script lang="ts">
	import type { WebSearchSource } from "$lib/types/WebSearch";
	import katex from "katex";
	import "katex/dist/contrib/mhchem.mjs";
	import DOMPurify from "isomorphic-dompurify";
	import { Marked } from "marked";
	import type { Tokens, TokenizerExtension, RendererExtension } from "marked";
	import CodeBlock from "../CodeBlock.svelte";

	export let content: string;
	export let sources: WebSearchSource[] = [];

	interface katexBlockToken extends Tokens.Generic {
		type: "katexBlock";
		raw: string;
		text: string;
		displayMode: true;
	}

	interface katexInlineToken extends Tokens.Generic {
		type: "katexInline";
		raw: string;
		text: string;
		displayMode: false;
	}

	export const katexBlockExtension: TokenizerExtension & RendererExtension = {
		name: "katexBlock",
		level: "block",

		start(src: string): number | undefined {
			const match = src.match(/(\${2}|\\\[)/);
			return match ? match.index : -1;
		},

		tokenizer(src: string): katexBlockToken | undefined {
			// 1) $$ ... $$
			const rule1 = /^\${2}([\s\S]+?)\${2}/;
			const match1 = rule1.exec(src);
			if (match1) {
				const token: katexBlockToken = {
					type: "katexBlock",
					raw: match1[0],
					text: match1[1].trim(),
					displayMode: true,
				};
				return token;
			}

			// 2) \[ ... \]
			const rule2 = /^\\\[([\s\S]+?)\\\]/;
			const match2 = rule2.exec(src);
			if (match2) {
				const token: katexBlockToken = {
					type: "katexBlock",
					raw: match2[0],
					text: match2[1].trim(),
					displayMode: true,
				};
				return token;
			}

			return undefined;
		},

		renderer(token) {
			if (token.type === "katexBlock") {
				return katex.renderToString(token.text, {
					throwOnError: false,
					displayMode: token.displayMode,
				});
			}

			return undefined;
		},
	};

	const katexInlineExtension: TokenizerExtension & RendererExtension = {
		name: "katexInline",
		level: "inline",

		start(src: string): number | undefined {
			const match = src.match(/(\$|\\\()/);
			return match ? match.index : -1;
		},

		tokenizer(src: string): katexInlineToken | undefined {
			// 1) $...$
			const rule1 = /^\$([^$]+?)\$/;
			const match1 = rule1.exec(src);
			if (match1) {
				const token: katexInlineToken = {
					type: "katexInline",
					raw: match1[0],
					text: match1[1].trim(),
					displayMode: false,
				};
				return token;
			}

			// 2) \(...\)
			const rule2 = /^\\\(([\s\S]+?)\\\)/;
			const match2 = rule2.exec(src);
			if (match2) {
				const token: katexInlineToken = {
					type: "katexInline",
					raw: match2[0],
					text: match2[1].trim(),
					displayMode: false,
				};
				return token;
			}

			return undefined;
		},

		renderer(token) {
			if (token.type === "katexInline") {
				return katex.renderToString(token.text, {
					throwOnError: false,
					displayMode: token.displayMode,
				});
			}
			return undefined;
		},
	};

	function escapeHTML(content: string) {
		return content.replace(
			/[<>&"']/g,
			(x) =>
				({
					"<": "&lt;",
					">": "&gt;",
					"&": "&amp;",
					"'": "&#39;",
					'"': "&quot;",
				}[x] || x)
		);
	}

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

	const marked = new Marked({
		hooks: {
			postprocess: (html) => DOMPurify.sanitize(addInlineCitations(html, sources)),
		},
		extensions: [katexBlockExtension, katexInlineExtension],
		renderer: {
			link: (href, title, text) =>
				`<a href="${href?.replace(/>$/, "")}" target="_blank" rel="noreferrer">${text}</a>`,
			html: (html) => escapeHTML(html),
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
