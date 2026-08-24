# Chat UI conversation scrolling product description

A written description of the user experience of conversation scrolling in Chat UI: what the user sees, what they can do, and exactly what happens when they do it.

## Purpose

Conversation scrolling is, from the user's point of view, a large state chart. The user moves through it with the product's inputs: sending and stopping messages, wheel and trackpad scrolls, scrollbar drags, touch drags and flicks, keyboard scrolling, the floating jump buttons, branch arrows, and regenerate. Most of that behavior is defined implicitly, spread across the scroll controller, the chat orchestration class, the chat window template, and the tests. There is no single place that says, in plain language, "when the user does X, this is what happens, and this is what happens if they do Y halfway through."

This project is that place. It describes the full experience a user has in the conversation view (`/conversation/[id]` and the home screen that becomes one), in the default configuration, with nothing customized.

The documents are for people who need to understand or change the product: designers, engineers, writers, testers, and anyone evaluating whether a behavior is intentional. They are written from the outside in. They describe the experience, not the implementation.

### What this is not

- Not API documentation. The scroll controller's public API is documented in the source at `src/lib/utils/scroll/`.
- Not organized by module. `stickToBottom.ts`, `chatScroll.svelte.ts`, and `ChatWindow.svelte` are not described separately. A single behavior is described once, wherever the user encounters it.
- Not a technical design document. Where a technical detail is critical to understanding the experience, it appears in a block quote labeled `Technical note:` and nowhere else.

## Conventions

- Describe the experience, not the code. "The reply streams into the blank space below your message and nothing on screen moves" rather than "the turn's min-height absorbs content growth so scrollHeight stays constant".
- Technical detail goes in block quotes, prefixed with `Technical note:`. Use it only when the mechanism changes what the user would expect.
- Use sentence case for headings.
- Name the vocabulary consistently. The [glossary](glossary.md) is the source of truth for terms like _following_, _the bottom_, _detach_, _re-attach_, _the anchored turn_, _the reservation_, and _the clearance_.
- Every document ends with the commit of `huggingface/chat-ui` it was verified against and a list of open questions.
- When a behavior is surprising, say so and say why it is that way if the reason is known. Do not smooth it over.

## The work to be done

Each document describes one feature. Features are large things (everything that happens between pressing Send and the reply settling) or small things (the two floating jump buttons), but each is described in full, including its edge cases and its interactions with other features.

### Document template

Every feature document follows the same skeleton so that documents are comparable and nothing is skipped.

1. **Summary.** One paragraph describing the feature abstractly. For example: "Sending a message scrolls the conversation so the sent message sits near the top of the view, and the reply streams into the blank space below it without moving anything on screen."
2. **The simple case.** The common path in prose.
3. **The interaction, event by event.** The five phases of a turn: **arming** (the send is accepted), **anchoring** (the new exchange appears and the view moves to it), **filling** (the reply grows inside the reserved space), **following** (growth past the reservation carries the view down), and **settling** (the stream ends and the view rests). What starts it and what is captured, what happens if it ends at once, what is decided the moment it becomes extended, what updates live, and what is committed at the end. Include a small state diagram (Mermaid `stateDiagram-v2`) of the states the user passes through.
4. **Modifiers.** A table of the product's variant axes — pointer kind (mouse/trackpad vs. touch), reduced motion, a hidden tab, a read-only or shared conversation, the artifact panel — and what each one does when set at the start and when changed _during_ the interaction.
5. **Cancel and interrupt.** The same checklist in every document:
   - The user's explicit abort: the Stop button ending generation early
   - The user doing something else mid-way: scrolling up to read, switching branches, regenerating, sending another message, switching conversations
   - The events the product treats as a clean "complete": the stream finishing, an error ending the turn
   - The environment failing: network lost mid-stream, the request failing, the tab hidden or backgrounded
   - The page or process going away: reload mid-stream, navigating away and back
   - Something else changing the target: a reply collapsing on regenerate, a branch switch replacing the tail, late images or markdown inflating earlier content
   - The input channel changing: the virtual keyboard opening or closing, switching between wheel, scrollbar, keyboard and touch, find-in-page jumps
6. **Interactions with other systems.** The product's cross-cutting concerns, in a fixed order: the composer and its clearance; the viewport and the virtual keyboard; reduced motion and hidden tabs; scrollbars and the gutter; shared and read-only conversations; the artifact panel.
7. **Edge cases.** Anything a user could notice that is not covered above.
8. **Open questions and verification.** The `huggingface/chat-ui` commit the document was verified against, and any behavior that could not be confirmed.

Item 5 matters most. Asking the same interrupt questions of every feature is how gaps and inconsistencies are found.

### Method

For each document:

1. Read `src/lib/utils/scroll/` (where the interaction state lives) and the relevant parts of `ChatWindow.svelte` (the surface).
2. Read the matching tests in `src/lib/utils/scroll/__tests__/`. `stickToBottom.svelte.test.ts` and `chatScroll.svelte.test.ts` are close to executable specifications of the edge cases; `harness.ts` documents how input and streaming are simulated, including the zero-layout-shift probe.
3. Draft the document.
4. Try anything ambiguous in the running product (`npm run dev`, localhost:5173). Tests settle "what happens"; the running product settles how it feels, what is visible while the interaction is in progress, and what the timing is like.
5. Record the commit verified against.

### Verification

Drafting reads the code; verification watches the product. The `verification/` directory holds one checklist per cluster of documents, each item a single observable claim with setup, steps, expected result, a priority, and the device it needs. A tester runs them in the conversation view, records `pass`, `fail`, or `blocked` in the Result column, and files every failure in `bug-triage.md` with the item's ID. A document moves from `drafted` to `verified` in the coverage table only when every P1 and P2 item for it has passed or been filed.

Many checklist items are also enforced by the automated browser suite (`npm run test`); those items name the test that covers them. Automated coverage does not substitute for the hand pass — it settles "what happens", not how it feels — but a checklist item whose test is red should never be hand-verified as `pass`.

`bug-triage.md` is the other half: every behavior the documents flagged as a likely defect, deduplicated, with reproduction steps, the reason in the code, a severity, and the decision the product team needs to make. Entries confirmed in the running product carry a Status line.

### Order of work

1. **Pilot: [the jump buttons](features/scroll-buttons.md).** Small and self-contained. Used to settle the template, tone, and depth.
2. **Foundations: [the scroll model](foundations/scroll-model.md) and [the turn reservation](foundations/turn-reservation.md).** Everything else refers to them.
3. **[Sending a message](features/sending-a-message.md) and [streaming and reading](features/streaming-and-reading.md).** The bulk of the experience and the hardest part. Written third so the template is already proven.
4. **Everything else.** Once the template and two exemplars exist, the remaining documents can be drafted in parallel, followed by a consistency pass and a verification pass across the whole set.

Progress is tracked in the [coverage table](#coverage) below.

### Scope decisions

- **Scrolling inside artifacts, code blocks, and the artifact panel.** Excluded. The artifact panel's code view reuses the same controller in a simpler configuration; it gets a short cross-cutting note, not a feature document, because its UX is "an editor pane", not "a conversation".
- **Message rendering (markdown, images, syntax highlighting).** Described inside each feature document only as a source of late content growth. A separate document would drift; what matters here is solely how growth moves — or must not move — the view.
- **The composer, the viewport, and accessibility.** Described once each in `cross-cutting/`, referenced from feature documents. Every feature interacts with them identically, so describing them per-feature would be repetition.
- **Interaction shape.** The unit of interaction is a turn and its phases are arming, anchoring, filling, following, settling. The interrupt list and the order of cross-cutting concerns are fixed as written in the document template above.
- **Numbered rules.** These are prose documents, not numbered specifications. Stable heading anchors are enough for cross-references.

## Structure

```
README.md                        this file
goal.md                          the standing instructions for whoever drafts
AGENTS.md, CLAUDE.md             entry points for agents: read README.md, then goal.md
glossary.md                      shared vocabulary
bug-triage.md                    suspected defects collected from every document, with repro steps and decisions needed

verification/
  README.md                      how to run a hand-verification pass and record results
  send-and-stream.md             checklist for features/sending-a-message.md and features/streaming-and-reading.md
  reading-and-buttons.md         checklist for features/streaming-and-reading.md (detach half) and features/scroll-buttons.md
  structure-changes.md           checklist for features/regenerating-and-branches.md and features/conversations-and-loading.md

foundations/
  scroll-model.md                pinning, what counts as user intent, follows and glides
  turn-reservation.md            the anchored turn, the reserved space a reply streams into

features/
  sending-a-message.md           send and edit-and-send: anchor, fill, follow, settle
  streaming-and-reading.md       reading during a stream: detaching, re-attaching, growth above and below
  regenerating-and-branches.md   regenerate, edits, and the branch arrows
  conversations-and-loading.md   first load, switching conversations, shared and resumed ones
  scroll-buttons.md              the floating jump-to-bottom and jump-to-previous buttons

cross-cutting/
  composer-viewport-gutter.md    the clearance, the virtual keyboard, the scrollbar gutter
  motion-and-accessibility.md    reduced motion, hidden tabs, keyboard scrolling, zero layout shift
```

## Coverage

Status is one of `not started`, `drafted`, or `verified`.

| Document                                  | Status  |
| ----------------------------------------- | ------- |
| glossary.md                               | drafted |
| bug-triage.md                             | drafted |
| verification/ (3 checklists)              | drafted |
| foundations/scroll-model.md               | drafted |
| foundations/turn-reservation.md           | drafted |
| features/sending-a-message.md             | drafted |
| features/streaming-and-reading.md         | drafted |
| features/regenerating-and-branches.md     | drafted |
| features/conversations-and-loading.md     | drafted |
| features/scroll-buttons.md                | drafted |
| cross-cutting/composer-viewport-gutter.md | drafted |
| cross-cutting/motion-and-accessibility.md | drafted |

## Reference

The source of truth is `huggingface/chat-ui` at `https://github.com/huggingface/chat-ui`. The relevant locations are:

- `src/routes/conversation/[id]/+page.svelte`: the surface this project describes — the conversation page, its send pipeline, and its loading flags
- `src/lib/utils/scroll/stickToBottom.ts`: where the pin/follow interaction state lives
- `src/lib/utils/scroll/chatScroll.svelte.ts`: the chat-level orchestration — anchor latch, buttons, clearance, reset
- `src/lib/utils/scroll/geometry.ts`: the numbers — offsets, clearance, and the reservation formula
- `src/lib/components/chat/ChatWindow.svelte`: the UI — the scroll container, the turn groups, the composer overlay, the buttons
- `src/lib/utils/scroll/__tests__/`: behavioral tests — a real-DOM browser harness with input simulation and a layout-shift probe
- `src/lib/components/chat/ArtifactPanel.svelte`: the second consumer of the controller (code view), shaping what the controller API must keep
