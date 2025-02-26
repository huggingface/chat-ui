import katex from "katex";
import "katex/dist/contrib/mhchem.mjs";
import { Marked } from "marked";
import type { Tokens, TokenizerExtension, RendererExtension } from "marked";
import type { WebSearchSource } from "$lib/types/WebSearch";

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
			})[x] || x
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

function createMarkedInstance(sources: WebSearchSource[]): Marked {
	return new Marked({
		hooks: {
			postprocess: (html) => addInlineCitations(html, sources),
		},
		extensions: [katexBlockExtension, katexInlineExtension],
		renderer: {
			link: (href, title, text) =>
				`<a href="${href?.replace(/>$/, "")}" target="_blank" rel="noreferrer">${text}</a>`,
			html: (html) => escapeHTML(html),
		},
		gfm: true,
		breaks: true,
	});
}
type CodeToken = {
	type: "code";
	lang: string;
	code: string;
};

type TextToken = {
	type: "text";
	html: string | Promise<string>;
};

export async function processTokens(content: string, sources: WebSearchSource[]): Promise<Token[]> {
	const marked = createMarkedInstance(sources);
	const tokens = marked.lexer(content);

	const processedTokens = await Promise.all(
		tokens.map(async (token) => {
			if (token.type === "code") {
				return {
					type: "code" as const,
					lang: token.lang,
					code: token.text,
				};
			} else {
				return {
					type: "text" as const,
					html: marked.parse(token.raw),
				};
			}
		})
	);

	return processedTokens;
}

export function processTokensSync(content: string, sources: WebSearchSource[]): Token[] {
	const marked = createMarkedInstance(sources);
	const tokens = marked.lexer(content);
	return tokens.map((token) => {
		if (token.type === "code") {
			return { type: "code" as const, lang: token.lang, code: token.text };
		}
		return { type: "text" as const, html: marked.parse(token.raw) };
	});
}

export type Token = CodeToken | TextToken;
