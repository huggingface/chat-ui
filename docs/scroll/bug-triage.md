# Bug triage

Suspected defects and open product decisions surfaced while drafting the documents. One entry per behavior, deduplicated. Severity: S1 breaks the experience, S2 visibly wrong, S3 polish. Entries confirmed in the running product carry a Status line.

---

## BT-1 · Branch arrows at the bottom do not reveal a longer alternative's end

- **From:** [regenerating-and-branches.md](features/regenerating-and-branches.md) · **Severity:** S3 · **Type:** product decision
- **Repro:** At the bottom of a conversation, use ‹ › on the last reply to switch to a much longer alternative.
- **Observed:** The view holds still (compared message stationary — as specified), so the longer alternative's end is below the fold and the view is detached; the jump button appears only if the distance exceeds 200px.
- **Why:** The hold-still rule is unconditional on switch; only a clamp (shorter alternative) re-attaches.
- **Decision needed:** Is hold-still the right call at the bottom, or should switching at the bottom re-attach? Current behavior matches the pre-rework product; keeping it is the default.

## BT-2 · Kept reservation reads as dead space on small phones

- **From:** [turn-reservation.md](foundations/turn-reservation.md) · **Severity:** S3 · **Type:** product taste
- **Repro:** On a small phone, send a message that gets a one-line reply; scroll around afterwards.
- **Observed:** Nearly a full screen of blank space below the reply until the next send, scrollable like content.
- **Why:** Reservations are kept after settling so the view never jumps at end-of-stream; this matches ChatGPT-style behavior, and the space clears on conversation switch.
- **Decision needed:** Accept (industry-standard), or explore collapsing the remainder on the next full user scroll-away. Collapsing at settle time is not an option — it would move the settled view, violating the zero-shift budget.

## BT-3 · Anchoring the first exchange changes the fresh-conversation feel

- **From:** [sending-a-message.md](features/sending-a-message.md) · **Severity:** S3 · **Type:** deliberate change, flagged for review
- **Repro:** From the home screen, send a first message.
- **Observed:** The message anchors 50px from the top with blank space below (previously: content simply started at the top and grew plainly, without a reservation).
- **Why:** The special case was removed for consistency — every turn anchors identically now.
- **Decision needed:** Confirm the consistent behavior is preferred; restoring the special case is a one-line gate on "is this the only turn".
