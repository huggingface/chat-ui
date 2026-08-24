# Goal

You are drafting or revising the conversation-scrolling product description. Read [README.md](README.md) first; it defines the document template, the vocabulary, and the order of work. This file is the standing instruction set for the drafting work itself.

## What you are producing

Prose documents that describe, from the outside in, what a user of Chat UI experiences when the conversation scrolls — or deliberately does not scroll. The reader should be able to predict the product's behavior in any situation covered by a document without reading the code.

## Rules

1. **Follow the template exactly.** Every feature document has the eight sections in the README's order. The five phases are always _arming, anchoring, filling, following, settling_. The cancel-and-interrupt checklist is identical, in the same order, in every document — if an item is not applicable, say so and say why rather than deleting the row.
2. **The glossary wins.** If a draft needs a term the glossary lacks, add it to the glossary in the same change. Never introduce a synonym for an existing term.
3. **Experience first, mechanism second.** Lead with what the user sees. Put mechanism in `Technical note:` block quotes, and only where the mechanism changes what a user would predict.
4. **Say the numbers.** "Within 60px of the bottom" is verifiable; "near the bottom" is not. Constants come from `src/lib/utils/scroll/geometry.ts` and `stickToBottom.ts`; if a constant changes, the documents are wrong until updated.
5. **Interrogate interrupts.** For every phase of every feature, ask what happens if each item of the interrupt checklist occurs _right then_. This is where the product's real behavior lives, and where bugs hide.
6. **Flag, don't fix.** When a described behavior looks like a defect, describe the actual behavior, mark it clearly ("This is surprising: …"), and add an entry to `bug-triage.md`. The documents describe what is, not what ought to be.
7. **Verify or admit.** Every claim is either confirmed by a named automated test, confirmed by hand in the running product, or listed under Open questions. No third state.
8. **Keep documents in lockstep with the code.** A pull request that changes scroll behavior updates the affected documents and the coverage table in the same PR. The verification commit at the foot of each document is the freshness marker.

## Definition of done for a document

- All eight sections present and non-empty.
- Every glossary term used correctly; no unlisted vocabulary.
- Interrupt checklist complete, with per-item answers.
- A Mermaid state diagram for the phase flow.
- Verification section names the commit and links every covering test or checklist item.
- Coverage table in README.md updated.
