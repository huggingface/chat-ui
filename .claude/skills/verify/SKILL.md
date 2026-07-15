---
name: verify
description: Build, launch, and drive chat-ui end-to-end against a mock streaming backend (no real LLM key) to verify UI/streaming changes at the real surface.
---

# Verifying chat-ui end-to-end

No LLM key is needed: point the app at a local OpenAI-compatible mock.

1. **Mock backend** (node, no deps): serve `GET /v1/models` returning
   `{"object":"list","data":[{"id":"test/thinker",...}]}` and
   `POST /v1/chat/completions`; when `stream: true`, write SSE
   `data: {"choices":[{"delta":{"content":"..."}}]}` chunks every ~60ms —
   start with `<think>` + ~45 chunks + `</think>` to exercise the reasoning
   block, then ~90 answer chunks; finish with `finish_reason:"stop"` then
   `data: [DONE]`. Answer non-stream requests (title generation) with a
   plain completion JSON.

2. **Launch**: write `.env.local` (gitignored) with
   `OPENAI_BASE_URL=http://127.0.0.1:<mockport>/v1`, `OPENAI_API_KEY=sk-mock`,
   `MONGODB_URL=` (empty → in-memory Mongo persisted to ./db), then
   `npm run dev` (port 5173). Ready in ~10s.

3. **Drive** with the repo's own playwright
   (`import { chromium } from "<repo>/node_modules/playwright/index.mjs"`;
   browsers live under `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` — if the
   pinned build number is missing, symlink the nearest build).

Gotchas:
- A **welcome modal** ("Start chatting") blocks the first visit — click it away.
- Wait ~600ms after load before typing (model list/settings hydration), and
  fall back to clicking `button[aria-label="Send message"]` if Enter races.
- The chat scroller is `[aria-label="Conversation messages"]`; user messages
  are `[data-message-type="user"]`; the live reasoning box is
  `.thinking-viewport`; assistant messages are `[data-message-role="assistant"]`.
- The FIRST exchange of a conversation deliberately does not anchor — do
  scroll-behavior measurements on the second send.
- While pinned, streaming text flows UP smoothly (spring follow) — when
  asserting "no jump", check for sudden DOWNWARD displacement of the answer
  text (view moving away from the live edge), not any motion.

Browser unit suites (not a substitute for driving the app):
`VITEST_BROWSER=true npx vitest run --project client src/lib/utils/scroll/`.
Two pre-existing client-suite failures are environmental (Tailwind cap
utilities don't load there): the OpenReasoningResults mask test and a
ToolCallsSummary expansion test.
