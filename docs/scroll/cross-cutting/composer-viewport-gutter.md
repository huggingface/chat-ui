# Composer, viewport and gutter

The three pieces of geometry every feature shares: the clearance above the composer, the view's height, and the scrollbar gutter.

## Summary

The composer floats over the bottom of the conversation; the **clearance** — bottom padding equal to the composer's height plus 24px, never less than 208px — guarantees the last line of content always rests above it, never behind it. The view's height defines the reservation and re-follows on change. The scrollbar gutter is reserved on both edges so content never reflows when the scrollbar appears, and half of it pads the composer so its text aligns with message text.

## The clearance

- The clearance is live: a growing draft (multiple lines, attached files, example chips) raises the composer and the clearance with it, and deleting the draft lowers both. It is not a ratchet — a tall composer that shrinks gives the space back.
- While a reply is filling its reservation, clearance changes are height-neutral: the reservation shrinks or grows by the exact amount the padding grows or shrinks, so the page height is constant and nothing moves. The anchored message keeps its 50px offset. (Once the reply has outgrown its reservation — or an extreme composer pushes the reservation below the turn's content — clearance changes are ordinary growth at the bottom: followed when following, invisible below the fold when detached.)
- Outside a reservation, clearance growth is ordinary content growth at the very bottom: followed with a snap when following, invisible when detached (it is below the fold).
- Before the composer's height is first measured (server-rendered paint), the clearance is its 208px floor, which matches the historical layout.

> Technical note: the clearance is the message column's `padding-bottom`, driven by one reactive number (`bottomClearance` in `src/lib/utils/scroll/geometry.ts`). No element is measured to maintain it; the composer's own size observer publishes its height.

## The viewport

- Window resizes and panel toggles change the view's height and width. A following view re-snaps to the bottom; a detached view relies on clamp and anchoring rules ([scroll model](../foundations/scroll-model.md)). The reservation recomputes from the new height, so the anchored message keeps its offset through resizes.
- The **virtual keyboard** is the important special case. Opening it shrinks the visible area (on iOS, without resizing anything the page can observe directly); closing it gives the space back. The product re-checks its geometry when the visual viewport changes, so a send from the keyboard — keyboard closing as the reply starts — lands the anchored exchange correctly in the restored, taller view.

  > Technical note: iOS resizes only `window.visualViewport` when the keyboard toggles; no resize observer fires anywhere. The controller listens to it and recomputes. Without this, the post-send geometry on mobile is computed against the keyboard-shrunk view and the anchor lands visibly wrong — the regression that motivated the listener predates this rework.

## The gutter

- The scroll container reserves the scrollbar's width on **both** edges (`scrollbar-gutter: stable both-edges`), so the appearance of a scrollbar (content first overflowing) never reflows the messages.
- On platforms with classic (space-taking) scrollbars this narrows the message column symmetrically; the composer, an overlay centered in the full width, pads itself by half the measured gutter on each side so composer text and message text stay exactly aligned. On overlay-scrollbar platforms the gutter is 0 and nothing changes.
- The gutter is re-measured only when the container's own box changes (resize, zoom, panel toggle) — never per frame.

## Open questions and verification

Verified against the commit that introduced this document, by `chatScroll.svelte.test.ts` (clearance floor and tracking, height-neutral mid-fill changes) and by hand for keyboard behavior on iOS Safari and Android Chrome. Open: Android's `interactive-widget` modes change whether the keyboard resizes the layout viewport; the current behavior is correct under the default, and a hand pass should confirm the manifest never opts into `resizes-content`.
