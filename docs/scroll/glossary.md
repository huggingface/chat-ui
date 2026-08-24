# Glossary

The source of truth for vocabulary in this description. Documents use these terms exactly; synonyms are listed only to be deprecated.

### the conversation view

The scrollable column of messages on `/conversation/[id]`, plus the composer overlaid at its bottom and the floating jump buttons. The only thing in the app that scrolls vertically on this page — the document itself never scrolls.

### turn

One exchange: a user message and the assistant messages that answer it, in order. The conversation view renders each turn as one group. A conversation that starts with assistant content (rare) has a headless leading turn.

### the bottom

The lowest scroll position of the conversation view. "At the bottom" means within 2px of it. The _distance from the bottom_ is how far above it the current position is, in pixels.

### the near-bottom zone

The lowest 60px of scroll positions. Scrolling down into this zone counts as returning to the bottom.

### following / pinned

The state in which the view is glued to the bottom: whenever content below grows, the view moves so the bottom stays visible. "Pinned" is the same state seen from the code's side; documents prefer _following_.

### detach

Leaving the following state by scrolling up. Any deliberate upward scroll — 3px of accumulated upward movement by wheel, trackpad, scrollbar drag, keyboard, or touch — detaches. Upward movement the browser makes on its own (no gesture behind it) does not: while following it is undone at once. While detached, content growth never moves the view.

### re-attach

Returning to the following state by scrolling down into the near-bottom zone, by an event that lands the view exactly at the bottom because content got shorter (see _clamp_), or by pressing the jump-to-bottom button. Re-attaching glides the remaining gap closed rather than snapping.

### snap

An instant, single-frame move of the view. Follows during content growth are snaps.

### glide

An animated move of the view that eases toward its target and keeps chasing it if the target moves (streaming keeps making the bottom lower). Used for sends on fine pointers, for the jump buttons, and for re-attach catch-up. A glide canceled by an upward scroll stops immediately and detaches. Very long glides teleport most of the distance first. Users with reduced motion, and hidden tabs, get snaps instead of glides.

### clamp

The browser forcing the scroll position down to the (new) bottom because content got shorter or the window got taller. A clamp lands the view exactly at the bottom; there is nothing below to read, so the view re-attaches.

### the anchored turn

The turn whose reply most recently streamed (or is streaming) in this session. It is the only turn with a _reservation_. The anchor moves to a new turn when its reply starts, stays after the reply finishes — surviving the end-of-stream reconciliation that re-identifies every message, and surviving switches among that turn's own reply alternatives — and clears when the user switches conversations or to a branch with a different trailing turn. A freshly loaded conversation has no anchored turn.

### the reservation

The minimum height given to the anchored turn while it is the last turn: the height of the view minus 50px of breathing room above it and minus the clearance below it. Because the turn owns this space from the start, the reply streams _into_ it — the page's total height does not change, so nothing on screen moves — and any space the reply does not use remains as blank space below it. Deprecated synonym: _spacer_ (the pre-2026 implementation, a separate element resized every frame).

### the anchor offset

50px: the breathing room kept above the anchored turn's first message when the view is at the bottom, and the landing offset of the jump-to-previous button.

### fill

The phase in which a reply grows inside its reservation. During fill, the view does not move at all.

### the clearance

The blank space kept between the last line of content and the composer overlay, so the composer never covers text: the composer's height plus 24px, and never less than 208px. Rendered as the message column's bottom padding.

### the composer

The message input overlaid at the bottom of the conversation view, including its attachments row, example chips, and the model line beneath it. Its height varies with the draft.

### the jump buttons

Two floating buttons at the lower right while the user is detached: _jump to bottom_ (down arrow: glide to the bottom and re-attach) and _jump to previous_ (up arrow: glide the previous user message to the anchor offset, staying detached). They appear once the distance from the bottom exceeds 200px and disappear inside 60px; jump-to-previous additionally requires being scrolled more than 200px from the top.

### branch switch

Using the ‹ › arrows on a message to show one of its alternatives. The tail of the conversation is replaced; the compared message must not move.

### regenerate

Requesting a new reply for the same user message (the retry button, or the error bar's Try again). Structurally: the old reply collapses and a fresh empty one takes its place, in the same turn.

### edit-and-send

Editing a previous user message and submitting the edit. Behaves like a send: a fresh turn (new user message and reply) becomes the last turn.

### streaming

The interval during which a reply is receiving content — from the moment loading starts until the stream ends, errs, or is stopped.

### the gutter

The space both edges of the scroll container reserve for the scrollbar so content never reflows when the scrollbar appears. Half of the measured gutter is added to the composer's padding so composer text and message text stay aligned.
