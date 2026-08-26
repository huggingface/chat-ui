/**
 * Geometry for the conversation scroll system: the anchor offset, the composer
 * clearance, and the turn reservation.
 *
 * The reservation replaces the old send-anchor spacer (an element after the
 * messages whose height was re-measured and rewritten on every content resize).
 * Instead, the turn whose reply is streaming gets a CSS min-height computed
 * from three slowly-changing numbers — nothing is measured per frame, and the
 * reply fills space its turn already owns, so the page height (and therefore
 * the view) does not move while it streams.
 */

/** Breathing room kept above the anchored turn's first message, and the
 * landing offset of the jump-to-previous button. */
export const ANCHOR_TOP_OFFSET_PX = 50;

/** Historical pb-52 clearance; the floor under the composer-tracked value,
 * and the value used before the composer's height is first measured. */
export const MIN_CLEARANCE_PX = 208;

/** Gap between the last content line and the composer's top edge. */
export const COMPOSER_CLEARANCE_PX = 24;

/**
 * The message column's bottom padding: never let content hide behind the
 * composer overlay. A tall draft or attached files can push the composer well
 * past the historical 208px clearance, which used to permanently occlude the
 * last lines of a reply.
 */
export function bottomClearance(composerHeight: number | undefined): number {
	if (!composerHeight) return MIN_CLEARANCE_PX;
	return Math.max(MIN_CLEARANCE_PX, composerHeight + COMPOSER_CLEARANCE_PX);
}

/**
 * The anchored turn's min-height. Scrolled fully to the bottom, the column's
 * padding puts the turn's bottom edge `clearance` above the viewport bottom,
 * so this height places the turn's first message `ANCHOR_TOP_OFFSET_PX` below
 * the viewport top — and everything the reply has not written yet is blank
 * space the stream fills without growing the page.
 */
export function anchorMinHeight(viewportHeight: number, clearance: number): number {
	return Math.max(0, viewportHeight - ANCHOR_TOP_OFFSET_PX - clearance);
}
