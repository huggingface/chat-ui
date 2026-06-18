/*
 * Copyright 2023 Vercel, Inc.
 * Adapted from: https://github.com/vercel/streamdown/blob/main/packages/streamdown/lib/parse-blocks.tsx
 */

import { Lexer } from "marked";

// Footnote identifiers must be alphanumeric, underscore, or hyphen (e.g., [^1], [^note], [^my-note]).
// A broader pattern like [^\]\s] would also match regex character classes such as [^\s>] inside
// code blocks, collapsing the whole document into a single block.
const footnoteReferencePattern = /\[\^[\w-]{1,200}\](?!:)/;
const footnoteDefinitionPattern = /\[\^[\w-]{1,200}\]:/;
const openingTagPattern = /<(\w+)[\s>]/;

// HTML void elements (self-closing tags) that don't need closing tags
const voidElements = new Set([
	"area",
	"base",
	"br",
	"col",
	"embed",
	"hr",
	"img",
	"input",
	"link",
	"meta",
	"param",
	"source",
	"track",
	"wbr",
]);

// Cache for tag patterns to avoid recreating RegExp objects
const openTagPatternCache = new Map<string, RegExp>();
const closeTagPatternCache = new Map<string, RegExp>();

function getOpenTagPattern(tagName: string): RegExp {
	const normalizedTag = tagName.toLowerCase();
	const cached = openTagPatternCache.get(normalizedTag);
	if (cached) {
		return cached;
	}
	const pattern = new RegExp(`<${normalizedTag}(?=[\\s>/])[^>]*>`, "gi");
	openTagPatternCache.set(normalizedTag, pattern);
	return pattern;
}

function getCloseTagPattern(tagName: string): RegExp {
	const normalizedTag = tagName.toLowerCase();
	const cached = closeTagPatternCache.get(normalizedTag);
	if (cached) {
		return cached;
	}
	const pattern = new RegExp(`</${normalizedTag}(?=[\\s>])[^>]*>`, "gi");
	closeTagPatternCache.set(normalizedTag, pattern);
	return pattern;
}

// Count opening tags that are neither void elements nor self-closing (e.g. <div />)
function countNonSelfClosingOpenTags(block: string, tagName: string): number {
	if (voidElements.has(tagName.toLowerCase())) {
		return 0;
	}
	const matches = block.match(getOpenTagPattern(tagName));
	if (!matches) {
		return 0;
	}
	let count = 0;
	for (const match of matches) {
		if (!match.trimEnd().endsWith("/>")) {
			count += 1;
		}
	}
	return count;
}

function countClosingTags(block: string, tagName: string): number {
	const matches = block.match(getCloseTagPattern(tagName));
	return matches ? matches.length : 0;
}

function countDoubleDollars(str: string): number {
	let count = 0;
	for (let i = 0; i < str.length - 1; i += 1) {
		if (str[i] === "$" && str[i + 1] === "$") {
			count += 1;
			i += 1; // Skip next character
		}
	}
	return count;
}

/**
 * Parses markdown into independent blocks for efficient memoization during streaming.
 * Blocks are split at natural boundaries while keeping related content together
 * (unclosed HTML elements, math blocks split by the lexer, footnotes).
 */
export function parseMarkdownIntoBlocks(markdown: string): string[] {
	// If footnotes are present, return the entire document as a single block.
	// This ensures footnote references and definitions remain in the same tree.
	if (footnoteReferencePattern.test(markdown) || footnoteDefinitionPattern.test(markdown)) {
		return [markdown];
	}

	const tokens = Lexer.lex(markdown, { gfm: true });

	// Post-process to merge consecutive blocks that belong together
	const mergedBlocks: string[] = [];
	const htmlStack: string[] = []; // Track opening HTML tags
	let previousTokenWasCode = false; // Track if previous non-space token was a code block

	for (const token of tokens) {
		const currentBlock = token.raw;
		const mergedBlocksLen = mergedBlocks.length;

		// We're inside an unclosed HTML block: merge with the previous block
		if (htmlStack.length > 0 && mergedBlocksLen > 0) {
			mergedBlocks[mergedBlocksLen - 1] += currentBlock;

			// Track nested opening and closing tags of the same type so that
			// inner closing tags don't prematurely close the outer block
			const trackedTag = htmlStack[htmlStack.length - 1];
			const newOpenTags = countNonSelfClosingOpenTags(currentBlock, trackedTag);
			const newCloseTags = countClosingTags(currentBlock, trackedTag);

			for (let i = 0; i < newOpenTags; i += 1) {
				htmlStack.push(trackedTag);
			}
			for (let i = 0; i < newCloseTags; i += 1) {
				if (htmlStack.length > 0 && htmlStack[htmlStack.length - 1] === trackedTag) {
					htmlStack.pop();
				}
			}
			continue;
		}

		// Check if this is an opening HTML block tag
		if (token.type === "html" && token.block) {
			const openingTagMatch = currentBlock.match(openingTagPattern);
			if (openingTagMatch) {
				const tagName = openingTagMatch[1];
				// Count how many tags remain unclosed within this block
				const openTags = countNonSelfClosingOpenTags(currentBlock, tagName);
				const closeTags = countClosingTags(currentBlock, tagName);
				if (openTags > closeTags) {
					// There is at least one unmatched opening tag, keep track of it
					htmlStack.push(tagName);
				}
			}
		}

		// Math block merging: if the previous block has unclosed math (odd number of $$),
		// merge the current block into it. This handles cases where marked's Lexer splits
		// math blocks (e.g. = on its own line is interpreted as a setext heading underline).
		// Skip if the previous block was a code block — code can legitimately contain $$
		// (e.g. the shell's current process ID).
		if (mergedBlocksLen > 0 && !previousTokenWasCode) {
			const previousBlock = mergedBlocks[mergedBlocksLen - 1];
			if (countDoubleDollars(previousBlock) % 2 === 1) {
				mergedBlocks[mergedBlocksLen - 1] = previousBlock + currentBlock;
				continue;
			}
		}

		mergedBlocks.push(currentBlock);

		// Track if this token was a code block (for next iteration), ignoring space tokens
		if (token.type !== "space") {
			previousTokenWasCode = token.type === "code";
		}
	}

	return mergedBlocks;
}
