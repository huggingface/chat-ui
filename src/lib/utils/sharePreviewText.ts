import type { Message } from "$lib/types/Message";

// Helpers to derive social-preview text (og: tags and thumbnail images) from
// shared conversations. User-authored content is untrusted: it can contain
// control characters, bidi overrides, zero-width characters, emoji and scripts
// the thumbnail font cannot render, so everything funnels through the
// sanitizers below.
//
// Regexes are built from codepoint tables (instead of unicode escapes) to keep
// the source ASCII-only and the covered ranges reviewable.

type CodepointRange = [start: number, end: number];

function rangeClass(ranges: CodepointRange[]): string {
	const part = (cp: number) => "\\u{" + cp.toString(16) + "}";
	return ranges.map(([a, b]) => (a === b ? part(a) : part(a) + "-" + part(b))).join("");
}

// Control chars, soft hyphen, bidi/format controls, zero-width chars, variation
// selectors, BOM, interlinear annotation marks. Replaced with spaces so words
// they separated do not merge.
const INVISIBLE_RE = new RegExp(
	"[" +
		rangeClass([
			[0x0000, 0x001f], // C0 controls (incl. \n and \t; whitespace is collapsed later)
			[0x007f, 0x009f], // DEL + C1 controls
			[0x00ad, 0x00ad], // soft hyphen
			[0x061c, 0x061c], // arabic letter mark
			[0x180e, 0x180e], // mongolian vowel separator
			[0x200b, 0x200f], // zero-width space/joiners, LRM/RLM
			[0x2028, 0x202e], // line/paragraph separators, bidi embeddings/overrides
			[0x2060, 0x2064], // word joiner, invisible operators
			[0x2066, 0x206f], // bidi isolates, deprecated format characters
			[0xfe00, 0xfe0f], // variation selectors
			[0xfeff, 0xfeff], // BOM / zero-width no-break space
			[0xfff9, 0xfffb], // interlinear annotation
		]) +
		"]",
	"gu"
);

// Emoji & pictographs, regional indicators (flags), skin tone modifiers, keycap
// combiner. Removed entirely: the bundled Inter font has no glyphs for them.
const EMOJI_RE = new RegExp(
	"\\p{Extended_Pictographic}|[" +
		rangeClass([
			[0x1f1e6, 0x1f1ff], // regional indicators
			[0x1f3fb, 0x1f3ff], // skin tone modifiers
			[0x20e3, 0x20e3], // combining enclosing keycap
		]) +
		"]",
	"gu"
);

// Approximation of Inter's glyph coverage: Latin (+extensions incl. Vietnamese),
// combining diacritics, IPA, Greek (+extended), Cyrillic, punctuation, currency,
// letterlike, number forms, arrows, math operators, misc technical, geometric
// shapes. Anything outside renders as tofu in the thumbnail, so runs of such
// characters are replaced with a single ellipsis.
const RENDERABLE_RE = new RegExp(
	"[" +
		rangeClass([
			[0x0020, 0x007e], // basic latin
			[0x00a0, 0x024f], // latin-1 supplement + latin extended-A/B
			[0x0250, 0x02ff], // IPA + spacing modifier letters
			[0x0300, 0x036f], // combining diacritical marks
			[0x0370, 0x03ff], // greek
			[0x0400, 0x052f], // cyrillic + supplement
			[0x1e00, 0x1eff], // latin extended additional (vietnamese)
			[0x1f00, 0x1fff], // greek extended
			[0x2000, 0x206f], // general punctuation (invisibles already stripped)
			[0x20a0, 0x20bf], // currency symbols
			[0x2100, 0x214f], // letterlike symbols
			[0x2150, 0x218b], // number forms
			[0x2190, 0x21ff], // arrows
			[0x2200, 0x22ff], // mathematical operators
			[0x2300, 0x23ff], // miscellaneous technical
			[0x25a0, 0x25ff], // geometric shapes
			[0x2c60, 0x2c7f], // latin extended-C
			[0xfb00, 0xfb06], // latin ligatures
		]) +
		"]",
	"u"
);

const ELLIPSIS = String.fromCharCode(0x2026);
// NUL is stripped by INVISIBLE_RE, so it can safely mark non-renderable runs.
const SENTINEL = String.fromCharCode(0);

/**
 * Clean user text for use in `<meta>` tags (og:description, og:title).
 * Keeps all scripts (CJK etc. are fine in metadata), strips control and
 * invisible/bidi characters, collapses whitespace and truncates on a word
 * boundary.
 */
export function cleanTextForMeta(text: string, maxLength: number): string {
	let out = text.normalize("NFC").replace(INVISIBLE_RE, " ");
	out = out.replace(/\s+/g, " ").trim();
	if (out.length > maxLength) {
		out = out.slice(0, maxLength).replace(/\s+\S*$/, "") + ELLIPSIS;
	}
	return out;
}

/**
 * Clean user text for rendering inside the share thumbnail, where only the
 * bundled Inter font is available. On top of `cleanTextForMeta`, emoji are
 * removed and runs of non-renderable characters (CJK, Arabic, ...) become a
 * single ellipsis. Returns "" when not enough renderable content remains, so
 * callers can fall back to a generic card.
 */
export function renderableThumbnailText(text: string, maxLength: number): string {
	let out = cleanTextForMeta(text, maxLength);
	out = out.replace(EMOJI_RE, "");
	out = [...out].map((ch) => (RENDERABLE_RE.test(ch) ? ch : SENTINEL)).join("");
	out = out.replace(new RegExp(SENTINEL + "+", "g"), ELLIPSIS);
	// Collapse whitespace and merge ellipses left adjacent after replacements
	out = out
		.replace(/\s+/g, " ")
		.replace(new RegExp(ELLIPSIS + "(\\s*" + ELLIPSIS + ")+", "g"), ELLIPSIS)
		.trim();
	const meaningful = out.replace(new RegExp("[" + ELLIPSIS + "\\s]", "g"), "");
	if (meaningful.length < 8) return "";
	return out;
}

/**
 * First user prompt of a conversation: walk the message tree from the root
 * (skipping system messages) and return the first user message content.
 * Falls back to array order for malformed trees.
 */
export function extractFirstUserPrompt(
	messages: Pick<Message, "id" | "from" | "content" | "children">[],
	rootMessageId?: Message["id"]
): string {
	const byId = new Map(messages.map((message) => [message.id, message]));
	let current = rootMessageId ? byId.get(rootMessageId) : undefined;
	for (let depth = 0; current && depth <= messages.length; depth++) {
		if (current.from === "user" && current.content.trim()) {
			return current.content;
		}
		current = current.children?.length ? byId.get(current.children[0]) : undefined;
	}
	return messages.find((m) => m.from === "user" && m.content.trim())?.content ?? "";
}
