import katex from "katex";
import "katex/dist/contrib/mhchem.mjs";
import { Marked } from "marked";
import type { Tokens, TokenizerExtension, RendererExtension } from "marked";
// Simple type to replace removed WebSearchSource
type SimpleSource = {
	title?: string;
	link: string;
};
import hljs from "highlight.js/lib/core";
import type { LanguageFn } from "highlight.js";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import shell from "highlight.js/lib/languages/shell";
import python from "highlight.js/lib/languages/python";
import go from "highlight.js/lib/languages/go";
import rust from "highlight.js/lib/languages/rust";
import java from "highlight.js/lib/languages/java";
import csharp from "highlight.js/lib/languages/csharp";
import cpp from "highlight.js/lib/languages/cpp";
import cLang from "highlight.js/lib/languages/c";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import scss from "highlight.js/lib/languages/scss";
import markdownLang from "highlight.js/lib/languages/markdown";
import yaml from "highlight.js/lib/languages/yaml";
import sql from "highlight.js/lib/languages/sql";
import plaintext from "highlight.js/lib/languages/plaintext";
import { parseIncompleteMarkdown } from "./parseIncompleteMarkdown";
import { parseMarkdownIntoBlocks } from "./parseBlocks";

const bundledLanguages: [string, LanguageFn][] = [
	["javascript", javascript],
	["typescript", typescript],
	["json", json],
	["bash", bash],
	["shell", shell],
	["python", python],
	["go", go],
	["rust", rust],
	["java", java],
	["csharp", csharp],
	["cpp", cpp],
	["c", cLang],
	["xml", xml],
	["html", xml],
	["css", css],
	["scss", scss],
	["markdown", markdownLang],
	["yaml", yaml],
	["sql", sql],
	["plaintext", plaintext],
];

bundledLanguages.forEach(([name, language]) => hljs.registerLanguage(name, language));

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

// =============================================================================
// HTML Sanitization Utilities
// =============================================================================

const HTML_ESCAPE_MAP: Record<string, string> = {
	"<": "&lt;",
	">": "&gt;",
	"&": "&amp;",
	"'": "&#39;",
	'"': "&quot;",
};

/**
 * Escapes HTML special characters to prevent XSS attacks.
 */
export function escapeHTML(content: string): string {
	return content.replace(/[<>&"']/g, (char) => HTML_ESCAPE_MAP[char] || char);
}

function addInlineCitations(md: string, webSearchSources: SimpleSource[] = []): string {
	const linkStyle =
		"color: rgb(59, 130, 246); text-decoration: none; hover:text-decoration: underline;";
	return md.replace(/\[(\d+)\]/g, (match: string) => {
		const indices: number[] = (match.match(/\d+/g) || []).map(Number);
		const links: string = indices
			.map((index: number) => {
				if (index === 0) return false;
				const source = webSearchSources[index - 1];
				if (source) {
					return `<a href="${escapeHTML(source.link)}" target="_blank" rel="noreferrer" style="${linkStyle}">${index}</a>`;
				}
				return "";
			})
			.filter(Boolean)
			.join(", ");
		return links ? ` <sup>${links}</sup>` : match;
	});
}

/**
 * Sanitizes href attributes, blocking dangerous URL schemes.
 */
function sanitizeHref(href?: string | null): string | undefined {
	if (!href) return undefined;
	const trimmed = href.trim();
	const lower = trimmed.toLowerCase();
	if (lower.startsWith("javascript:") || lower.startsWith("data:text/html")) {
		return undefined;
	}
	return trimmed.replace(/>$/, "");
}

function highlightCode(text: string, lang?: string): string {
	if (lang && hljs.getLanguage(lang)) {
		try {
			return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
		} catch {
			// fall through to auto-detect
		}
	}
	return hljs.highlightAuto(text).value;
}

// =============================================================================
// Video Tag Sanitization
//
// Allows safe <video> embeds while blocking XSS vectors like event handlers
// (onerror, onload), dangerous URL schemes, and arbitrary attributes.
// =============================================================================

export type ParsedAttributes = Record<string, string | true>;

/**
 * Parses HTML attribute strings into a key-value object.
 * Handles: double-quoted, single-quoted, unquoted, and boolean attributes.
 */
export function parseAttributes(raw: string): ParsedAttributes {
	const attrs: ParsedAttributes = {};
	const attrRegex = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
	let match: RegExpExecArray | null;
	while ((match = attrRegex.exec(raw))) {
		const name = match[1];
		const value = match[2] ?? match[3] ?? match[4];
		attrs[name] = value ?? true;
	}
	return attrs;
}

/**
 * Validates media URLs, allowing only safe schemes.
 * Returns the sanitized URL or undefined if unsafe.
 */
export function isSafeMediaUrl(url?: string): string | undefined {
	if (!url) return undefined;
	const trimmed = url.trim();
	if (trimmed === "") return undefined;

	const lower = trimmed.toLowerCase();
	const isSafeScheme =
		lower.startsWith("http://") ||
		lower.startsWith("https://") ||
		trimmed.startsWith("/") ||
		trimmed.startsWith("./") ||
		trimmed.startsWith("../");

	return isSafeScheme ? trimmed : undefined;
}

// Whitelist of allowed boolean attributes on <video> tags
const ALLOWED_VIDEO_BOOLEANS = new Set(["controls", "autoplay", "loop", "muted", "playsinline"]);

/**
 * Filters video tag attributes, keeping only safe ones.
 */
function filterVideoAttributes(attrs: ParsedAttributes): string[] {
	const result: string[] = [];

	for (const [name, value] of Object.entries(attrs)) {
		// Boolean attributes (controls, autoplay, etc.)
		if (ALLOWED_VIDEO_BOOLEANS.has(name)) {
			if (value === true || value === "" || value === name) {
				result.push(name);
			}
			continue;
		}

		// Poster URL - must be safe
		if (name === "poster") {
			const safePoster = typeof value === "string" ? isSafeMediaUrl(value) : undefined;
			if (safePoster) {
				result.push(`poster="${escapeHTML(safePoster)}"`);
			}
			continue;
		}

		// Dimensions - must be positive integers
		if (name === "width" || name === "height") {
			const num = typeof value === "string" ? Number.parseInt(value, 10) : NaN;
			if (Number.isFinite(num) && num > 0) {
				result.push(`${name}="${num}"`);
			}
		}
		// All other attributes are stripped for security
	}

	return result;
}

/**
 * Extracts and sanitizes <source> elements from video inner HTML.
 */
function extractSafeSources(innerHtml: string): string[] {
	const sourceRegex = /<source\b([^>]*)>/gi;
	const safeSources: string[] = [];

	let match: RegExpExecArray | null;
	while ((match = sourceRegex.exec(innerHtml))) {
		const attrs = parseAttributes(match[1] ?? "");

		// src is required and must be safe
		const src = isSafeMediaUrl(typeof attrs.src === "string" ? attrs.src : undefined);
		if (!src) continue;

		// type is optional but must be video/* if present
		const rawType = typeof attrs.type === "string" ? attrs.type : undefined;
		const type = rawType?.toLowerCase().startsWith("video/") ? rawType : undefined;
		const typeAttr = type ? ` type="${escapeHTML(type)}"` : "";

		safeSources.push(`<source src="${escapeHTML(src)}"${typeAttr}>`);
	}

	return safeSources;
}

/**
 * Sanitizes a <video> HTML string, stripping dangerous attributes and URLs.
 * Returns null if the input is not a valid video tag.
 */
export function sanitizeVideoHtml(html: string): string | null {
	const trimmed = html.trim();

	// Match complete video tags only
	const videoMatch = /^<video\b([^>]*)>([\s\S]*?)<\/video>$/i.exec(trimmed);
	if (!videoMatch) return null;

	const rawAttrs = videoMatch[1] ?? "";
	const innerHtml = videoMatch[2] ?? "";

	// Filter attributes to whitelist
	const safeAttrs = filterVideoAttributes(parseAttributes(rawAttrs));

	// Extract safe source elements
	const safeSources = extractSafeSources(innerHtml);

	// Extract and escape fallback text (anything not in a <source> tag)
	const fallbackText = innerHtml.replace(/<source\b[^>]*>/gi, "").trim();
	const escapedFallback = fallbackText ? escapeHTML(fallbackText) : "";

	// Reconstruct safe video tag
	const attrString = safeAttrs.join(" ");
	const leadingSpace = attrString ? " " : "";
	return `<video${leadingSpace}${attrString}>${safeSources.join("")}${escapedFallback}</video>`;
}

function createMarkedInstance(sources: SimpleSource[]): Marked {
	return new Marked({
		hooks: {
			postprocess: (html) => addInlineCitations(html, sources),
		},
		extensions: [katexBlockExtension, katexInlineExtension],
		renderer: {
			link: (href, title, text) => {
				const safeHref = sanitizeHref(href);
				return safeHref
					? `<a href="${escapeHTML(safeHref)}" target="_blank" rel="noreferrer">${text}</a>`
					: `<span>${escapeHTML(text ?? "")}</span>`;
			},
			html: (html) => sanitizeVideoHtml(html) ?? escapeHTML(html),
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

const blockCache = new Map<string, BlockToken>();

function cacheKey(index: number, blockContent: string, sources: SimpleSource[]) {
	const sourceKey = sources.map((s) => s.link).join("|");
	return `${index}-${hashString(blockContent)}|${sourceKey}`;
}

export async function processTokens(content: string, sources: SimpleSource[]): Promise<Token[]> {
	// Apply incomplete markdown preprocessing for smooth streaming
	const processedContent = parseIncompleteMarkdown(content);

	const marked = createMarkedInstance(sources);
	const tokens = marked.lexer(processedContent);

	const processedTokens = await Promise.all(
		tokens.map(async (token) => {
			if (token.type === "code") {
				return {
					type: "code" as const,
					lang: token.lang,
					code: highlightCode(token.text, token.lang),
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
	// Apply incomplete markdown preprocessing for smooth streaming
	const processedContent = parseIncompleteMarkdown(content);

	const marked = createMarkedInstance(sources);
	const tokens = marked.lexer(processedContent);
	return tokens.map((token) => {
		if (token.type === "code") {
			return {
				type: "code" as const,
				lang: token.lang,
				code: highlightCode(token.text, token.lang),
				rawCode: token.text,
				isClosed: isFencedBlockClosed(token.raw ?? ""),
			};
		}
		return { type: "text" as const, html: marked.parse(token.raw) };
	});
}

export type Token = CodeToken | TextToken;

export type BlockToken = {
	id: string;
	content: string;
	tokens: Token[];
};

/**
 * Simple hash function for generating stable block IDs
 */
function hashString(str: string): string {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash = hash & hash; // Convert to 32bit integer
	}
	return Math.abs(hash).toString(36);
}

/**
 * Process markdown content into blocks with stable IDs for efficient memoization.
 * Each block is processed independently and assigned a content-based hash ID.
 */
export async function processBlocks(
	content: string,
	sources: SimpleSource[] = []
): Promise<BlockToken[]> {
	const blocks = parseMarkdownIntoBlocks(content);

	return await Promise.all(
		blocks.map(async (blockContent, index) => {
			const key = cacheKey(index, blockContent, sources);
			const cached = blockCache.get(key);
			if (cached) return cached;

			const tokens = await processTokens(blockContent, sources);
			const block: BlockToken = {
				id: `${index}-${hashString(blockContent)}`,
				content: blockContent,
				tokens,
			};
			blockCache.set(key, block);
			return block;
		})
	);
}

/**
 * Synchronous version of processBlocks for SSR
 */
export function processBlocksSync(content: string, sources: SimpleSource[] = []): BlockToken[] {
	const blocks = parseMarkdownIntoBlocks(content);

	return blocks.map((blockContent, index) => {
		const key = cacheKey(index, blockContent, sources);
		const cached = blockCache.get(key);
		if (cached) return cached;

		const tokens = processTokensSync(blockContent, sources);
		const block: BlockToken = {
			id: `${index}-${hashString(blockContent)}`,
			content: blockContent,
			tokens,
		};
		blockCache.set(key, block);
		return block;
	});
}
