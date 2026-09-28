/**
 * Where a character offset sits inside a textarea, in the textarea's own
 * coordinate space.
 *
 * A textarea gives no read access to its glyph positions, so the only way to
 * measure one is the mirror trick: build a hidden div that wraps text exactly
 * the way the textarea does, put the text up to the offset in it, and read back
 * the position of a marker span. The mirror has to copy every property that can
 * change where a line breaks — font, padding, border, width, letter spacing,
 * wrapping — or the measurement drifts from the real caret as the text grows.
 */

/**
 * Properties that affect line breaking and glyph placement. Copied from the
 * live element rather than assumed, so a theme or zoom change cannot desync the
 * mirror from the textarea it is imitating.
 */
const MIRRORED_PROPERTIES = [
	"box-sizing",
	"width",
	"border-top-width",
	"border-right-width",
	"border-bottom-width",
	"border-left-width",
	"padding-top",
	"padding-right",
	"padding-bottom",
	"padding-left",
	"font-family",
	"font-size",
	"font-weight",
	"font-style",
	"font-variant",
	"font-stretch",
	"letter-spacing",
	"word-spacing",
	"line-height",
	"text-indent",
	"text-transform",
	"white-space",
	"word-break",
	"overflow-wrap",
	"tab-size",
] as const;

export interface CaretCoordinates {
	/** Offset from the textarea's left padding edge, in CSS pixels. */
	left: number;
	/** Offset from the textarea's top padding edge, in CSS pixels. */
	top: number;
	/** Height of one line at the caret, so a caller can clear the glyph. */
	height: number;
}

/**
 * Measure the caret position for `offset` within `textarea`.
 *
 * The returned coordinates are relative to the textarea's border box and
 * already account for its scroll position, so adding them to the textarea's own
 * offset gives a position inside the composer.
 */
export function getCaretCoordinates(
	textarea: HTMLTextAreaElement,
	offset: number
): CaretCoordinates {
	const style = window.getComputedStyle(textarea);
	const mirror = document.createElement("div");

	for (const property of MIRRORED_PROPERTIES) {
		mirror.style.setProperty(property, style.getPropertyValue(property));
	}

	// Off-screen but laid out: `visibility: hidden` still computes geometry,
	// where `display: none` would report zeros for everything.
	mirror.style.position = "absolute";
	mirror.style.visibility = "hidden";
	mirror.style.top = "0";
	mirror.style.left = "-9999px";
	// The textarea wraps rather than scrolling horizontally, and its own
	// `white-space` may be a value that would collapse the runs of spaces the
	// measurement depends on.
	mirror.style.whiteSpace = "pre-wrap";
	mirror.style.overflowWrap = "break-word";
	mirror.style.height = "auto";
	mirror.style.overflow = "hidden";

	const value = textarea.value;
	const safeOffset = Math.max(0, Math.min(offset, value.length));
	// A trailing newline collapses in layout, so the marker after one would be
	// measured on the previous line. The zero-width space holds the new line open.
	mirror.textContent = value.slice(0, safeOffset).replace(/\n$/, "\n​");

	const marker = document.createElement("span");
	// Non-empty for the same reason: an empty span has no box to measure.
	marker.textContent = value.slice(safeOffset) || ".";
	mirror.appendChild(marker);

	document.body.appendChild(mirror);
	const left = marker.offsetLeft;
	const top = marker.offsetTop;
	const lineHeight = parseFloat(style.lineHeight);
	document.body.removeChild(mirror);

	return {
		left: left - textarea.scrollLeft,
		top: top - textarea.scrollTop,
		// `line-height: normal` parses as NaN; the font size is the closest
		// defensible fallback and only affects how far the panel clears the text.
		height: Number.isFinite(lineHeight) ? lineHeight : parseFloat(style.fontSize) || 16,
	};
}
