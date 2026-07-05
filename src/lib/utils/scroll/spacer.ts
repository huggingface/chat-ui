/**
 * Geometry for the ChatGPT-style send anchor.
 *
 * When the user sends a message, a spacer below the messages is inflated so
 * that, scrolled fully to the bottom, the sent message sits `topOffset` below
 * the viewport top and the reply streams into the pre-made space. Because the
 * spacer shrinks 1:1 as the reply grows, scrollHeight stays constant through
 * the fill phase — the view doesn't move and there is no layout shift. Once
 * the spacer reaches `minSpacer`, scrollHeight starts growing and the
 * stick-to-bottom follow takes over.
 *
 * `minSpacer` doubles as the clearance that keeps content readable above the
 * absolutely-positioned composer overlay, so it must track the composer's real
 * rendered height rather than a hardcoded padding.
 */

export interface SpacerGeometry {
	/** Scroll container clientHeight. */
	viewportHeight: number;
	/** Distance from the anchored user message's top to the spacer's top. */
	anchorToSpacer: number;
	/** Floor: composer clearance (see `minSpacerHeight`). */
	minSpacer: number;
	/** Breathing room kept above the anchored message. */
	topOffset: number;
}

export const SPACER_TOP_OFFSET_PX = 50;
/** Historical pb-52 clearance; used when the composer height isn't known yet. */
export const MIN_SPACER_FALLBACK_PX = 208;
/** Gap between the last content line and the composer's top edge. */
export const COMPOSER_CLEARANCE_PX = 24;

export function computeSpacerHeight({
	viewportHeight,
	anchorToSpacer,
	minSpacer,
	topOffset,
}: SpacerGeometry): number {
	return Math.max(minSpacer, viewportHeight - anchorToSpacer - topOffset);
}

/**
 * The spacer floor: never let content hide behind the composer overlay. A tall
 * draft or attached files can push the composer well past the historical 208px
 * clearance, which used to permanently occlude the last lines of a reply.
 */
export function minSpacerHeight(composerHeight: number | undefined): number {
	if (!composerHeight) return MIN_SPACER_FALLBACK_PX;
	return Math.max(MIN_SPACER_FALLBACK_PX, composerHeight + COMPOSER_CLEARANCE_PX);
}
