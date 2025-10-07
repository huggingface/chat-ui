import katex from "katex";
import "katex/dist/contrib/mhchem.mjs";
import { Marked } from "marked";
import type { Tokens, TokenizerExtension, RendererExtension } from "marked";
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

const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

function escapeAttribute(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function sanitizeHrefAttribute(
	href: string | undefined,
	{ allowRelative = false }: { allowRelative?: boolean } = {}
): string {
	if (!href) return "";
	const trimmed = href.replace(/>$/, "");

	const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed);
	if (hasScheme) {
		try {
			const parsed = new URL(trimmed);
			if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
				return "";
			}
			return escapeAttribute(trimmed);
		} catch {
			return "";
		}
	}

	if (!allowRelative) {
		return "";
	}

	if (/^(?:#|\/|\.\/|\.\.\/)/.test(trimmed)) {
		return escapeAttribute(trimmed);
	}

	return "";
}

function createMarkedInstance(): Marked {
	return new Marked({
		// No citation postprocessing; render content as-is.
		extensions: [katexBlockExtension, katexInlineExtension],
		renderer: {
			link: (href, _title, text) => {
				const safeHref = sanitizeHrefAttribute(href, { allowRelative: true });
				const safeText = escapeHTML(text ?? "");
				return safeHref
					? `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${safeText}</a>`
					: safeText;
			},
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

export async function processTokens(content: string): Promise<Token[]> {
	const marked = createMarkedInstance();
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

export function processTokensSync(content: string): Token[] {
	const marked = createMarkedInstance();
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
