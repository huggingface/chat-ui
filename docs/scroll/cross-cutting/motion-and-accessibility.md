# Motion and accessibility

Reduced motion, hidden tabs, keyboard access, and the zero-layout-shift budget.

## Summary

Every animated move in the conversation view degrades to an instant one for users who ask for reduced motion, and in hidden tabs where animation frames are throttled. The conversation is fully keyboard-scrollable. And the system holds itself to a hard budget: **zero unexpected layout shift** — motion only ever equals content change or an explicitly requested move.

## Reduced motion

With `prefers-reduced-motion: reduce`, glides (send, jump buttons, re-attach catch-up) become instant moves; follows were already snaps. No behavior differs otherwise — thresholds, anchoring, and the reservation are identical, and the reservation's stillness during fill is itself the most motion-free streaming presentation available.

## Hidden tabs

A backgrounded tab keeps following synchronously (its animation frames are throttled, so deferred snaps would lag by seconds). Returning to the tab shows the current state with nothing left to replay: no catch-up glide, no queued animations. A glide requested just before hiding completes instantly.

## Keyboard

The conversation container is focusable (the page itself never scrolls, so without this, keyboard-only users could not scroll the conversation at all). Arrow keys, PageUp/PageDown, Home/End scroll it natively; upward keys detach and End (or PageDown into the near-bottom zone) re-attaches, by position, exactly like every other input. Keys pressed inside the composer or any input never scroll the conversation. Focus outlines and reading order are unaffected by scroll state.

## The zero-layout-shift budget

The system's defining constraint: a user watching any fixed point of content must never see it move except by (a) their own scrolling, (b) a move they explicitly requested (send, jump buttons), or (c) real content change at that point. Concretely:

- Filling a reservation moves nothing — page height is constant by construction.
- Follows move the view by exactly the content growth, in the same frame's paint.
- Growth above a detached reader is compensated (scroll anchoring) so their line holds still.
- Structure changes (regenerate's collapse, branch swaps) are absorbed by the reservation or happen below the fold; only a clamp — the browser's own floor — can move a parked view, and it lands at a meaningful place (the bottom).

> Technical note: this budget is enforced, not aspired to — the browser test harness runs a `PerformanceObserver` layout-shift probe (`startClsProbe` in `src/lib/utils/scroll/__tests__/harness.ts`) and asserts a score of zero across streaming scenarios. A change that reintroduces shift fails CI, not review.

## Open questions and verification

Verified against the commit that introduced this document, by `stickToBottom.svelte.test.ts` (reduced-motion instant moves, CLS probe) and the harness's design. Open: hidden-tab behavior is exercised indirectly (the synchronous-write path), as headless CI cannot truly background a tab; a hand pass should confirm no replayed motion after long background streaming on battery-saver Android, the harshest throttling regime.
