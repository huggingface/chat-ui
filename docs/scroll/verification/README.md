# Verification

How to run a hand-verification pass over the scroll documents and record results.

## Setup

- A checkout of `huggingface/chat-ui` at the commit under test; `npm run dev` against any OpenAI-compatible endpoint (a slow-streaming model makes mid-stream checks much easier; `.env.local` with the HF router works).
- Devices per item: **desktop** (a mouse _and_ a trackpad where noted), **touch** (a real phone — the devtools emulator does not reproduce momentum or the virtual keyboard), **reduced-motion** (the OS setting, not devtools, where noted).
- Before a pass, run the automated suite (`npm run test`). A checklist item whose named test is red is recorded `blocked`, not hand-verified.

## Recording

Each checklist is a table. Fill the Result column with `pass`, `fail`, or `blocked` and the date. Every `fail` gets an entry in [bug-triage.md](../bug-triage.md) referencing the item ID. A document flips to `verified` in the [coverage table](../README.md#coverage) when all its P1 and P2 items are `pass` or filed.

## Priorities

- **P1** — a failure breaks the core experience (following, detaching, the anchor).
- **P2** — visibly wrong but recoverable (thresholds, glides, buttons).
- **P3** — polish and rare-device behavior.

## Checklists

- [send-and-stream.md](send-and-stream.md) — sending, anchoring, filling, following, settling
- [reading-and-buttons.md](reading-and-buttons.md) — detach/re-attach and the jump buttons
- [structure-changes.md](structure-changes.md) — regenerate, branches, switching, loading
