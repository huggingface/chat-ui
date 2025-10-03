import katex from "katex";
import "katex/dist/contrib/mhchem.mjs";
import { Marked } from "marked";
import type { Tokens, TokenizerExtension, RendererExtension } from "marked";
// Simple type to replace removed WebSearchSource
type SimpleSource = {
	title?: string;
	link: string;
};
import hljs from "highlight.js";

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
			const content = match1[1];
			const trimmed = content.trim();
			const looksLikeCurrency = /^[0-9][0-9,]*(?:\.[0-9]+)?(?:\s*\[\d+\])?$/.test(trimmed);
			const looksLikeSentence = /[A-Za-z]{3,}/.test(trimmed) && /\s/.test(trimmed);
			const hasMathControl = /[\\^_=]/.test(trimmed);
			const probablyMath = hasMathControl || /\d\s*[-+*/]\s*\d/.test(trimmed);
			// Treat $amount or plain prose as literal text unless explicit math is present
			if (!probablyMath && (looksLikeCurrency || looksLikeSentence)) {
				return undefined;
			}
			const token: katexInlineToken = {
				type: "katexInline",
				raw: match1[0],
				text: trimmed,
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

function transformOutsideHtmlCode(html: string, transform: (segment: string) => string): string {
	const parts = html.split(/(<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>)/gi);
	return parts
		.map((part) => (/^<pre|^<code/i.test(part) ? part : transform(part)))
		.join("");
}

function addInlineCitations(html: string, webSearchSources: SimpleSource[] = []): string {
	const linkStyle =
		"color: rgb(59, 130, 246); text-decoration: none; hover:text-decoration: underline;";
	const applyReplacements = (value: string) =>
		value
			.replace(/\[(\d+)\](?!\()/g, (match: string) => {
				const indices: number[] = (match.match(/\d+/g) || []).map(Number);
				const links: string = indices
					.map((index: number) => {
						if (index === 0) return "";
						const source = webSearchSources[index - 1];
						if (!source) return "";
						return `<a href="${source.link}" target="_blank" rel="noopener noreferrer" style="${linkStyle}">${index}</a>`;
					})
					.filter(Boolean)
					.join(", ");
				return links ? ` <sup>${links}</sup>` : match;
			})
			.replace(/(?:\(|\s)(\d+(?:\s*,\s*\d+)*)\)/g, (match: string, group: string) => {
				const indices = group
					.split(/\s*,\s*/)
					.map((value) => Number(value.trim()))
					.filter((value) => Number.isFinite(value) && value > 0);
				if (indices.length === 0) return match;
				const links = indices
					.map((index: number) => {
						const source = webSearchSources[index - 1];
						if (!source) return "";
						return `<a href="${source.link}" target="_blank" rel="noopener noreferrer" style="${linkStyle}">${index}</a>`;
					})
					.filter(Boolean)
					.join(", ");
				return links ? ` (<sup>${links}</sup>)` : match;
			});

	const decorate = (segment: string) => applyReplacements(segment);
	return transformOutsideHtmlCode(html, decorate);
}

function createMarkedInstance(sources: SimpleSource[]): Marked {
	return new Marked({
			hooks: {
				postprocess: (html) => addInlineCitations(html, sources),
			},
		extensions: [katexBlockExtension, katexInlineExtension],
			renderer: {
				link: (href, title, text) =>
					`<a href="${href?.replace(/>$/, "")}" target="_blank" rel="noopener noreferrer">${text}</a>`,
			html: (html) => escapeHTML(html),
		},
		gfm: true,
		breaks: true,
	});
}
function isFencedBlockClosed(raw?: string): boolean {
	if (!raw) return true;
	/* eslint-disable-next-line no-control-regex */
	const trimmed = raw.replace(/[\s\u0000]+$/, "");
	const openingFenceMatch = trimmed.match(/^([`~]{3,})/);
	if (!openingFenceMatch) {
		return true;
	}
	const fence = openingFenceMatch[1];
	const closingFencePattern = new RegExp(`(?:\n|\r\n)${fence}(?:[\t ]+)?$`);
	return closingFencePattern.test(trimmed);
}

type CodeToken = {
	type: "code";
	lang: string;
	code: string;
	rawCode: string;
	isClosed: boolean;
};

type TextToken = {
	type: "text";
	html: string | Promise<string>;
};

export async function processTokens(content: string, sources: SimpleSource[]): Promise<Token[]> {
	const marked = createMarkedInstance(sources);
	const tokens = marked.lexer(content);

	const processedTokens = await Promise.all(
		tokens.map(async (token) => {
			if (token.type === "code") {
				return {
					type: "code" as const,
					lang: token.lang,
					code: hljs.highlightAuto(token.text, hljs.getLanguage(token.lang)?.aliases).value,
					rawCode: token.text,
					isClosed: isFencedBlockClosed(token.raw ?? ""),
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

export function processTokensSync(content: string, sources: SimpleSource[]): Token[] {
	const marked = createMarkedInstance(sources);
	const tokens = marked.lexer(content);
	return tokens.map((token) => {
		if (token.type === "code") {
			return {
				type: "code" as const,
				lang: token.lang,
				code: hljs.highlightAuto(token.text, hljs.getLanguage(token.lang)?.aliases).value,
				rawCode: token.text,
				isClosed: isFencedBlockClosed(token.raw ?? ""),
			};
		}
		return { type: "text" as const, html: marked.parse(token.raw) };
	});
}

export type Token = CodeToken | TextToken;
