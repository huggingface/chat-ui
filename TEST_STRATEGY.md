# chat-ui — Regression & Backwards-Compatibility Test Strategy

**Status:** proposal · **Date:** 2026-07-20 · **Baseline commit:** `6c3182e0`

---

## 0. Executive summary

I mapped the codebase (310 source modules, ~35k LOC across `src/lib` + `src/routes`), audited all 43 test
files, ran every suite, and prototyped a hermetic end-to-end stack to verify it is achievable.

### The five findings that matter

**1. The browser test suite has been disabled in CI since February 2026 — and it is red on `main` today.**

`vite.config.ts:45` gates the entire `client` vitest workspace behind `VITEST_BROWSER=true`. That variable
is set nowhere — not in `package.json`, not in `.github/workflows/lint-and-test.yml`. CI even runs
`npx playwright install` (line 42) for a workspace it never instantiates.

Measured on this branch:

```
VITEST_BROWSER=true npx vitest --run --project=client
  Test Files  2 failed | 4 passed (6)
       Tests  2 failed | 73 passed (75)
    Duration  15.96s
```

Two live failures nobody has seen:

| Test                                     | Failure                                                                       | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OpenReasoningResults.svelte.test.ts:28` | `expected false to be true` — the viewport's `linear-gradient` mask is absent | **Missing stylesheet.** The component CSS is intact (`OpenReasoningResults.svelte:95-97`) but gated on `.has-overflow`, i.e. `contentHeight > viewportHeight`. The viewport's height cap is the Tailwind utility `max-h-56`, and `vitest-setup-client.ts` was empty, so no stylesheet was ever loaded into the browser workspace. Uncapped, the viewport grew to fit its content, overflow never occurred, and the mask never applied. (My first read of this was a ResizeObserver race — the measurement _is_ async, but that was not why it never became true.) |
| `ToolCallsSummary.svelte.test.ts:60`     | `expected [Function elements] to have a length of 2 but got +0`               | Malformed assertion — `.elements` is read, not called, so it asserts the function's arity. Could never have passed in any state of the code                                                                                                                                                                                                                                                                                                                                                                                                                       |

Those 75 tests cost **16 seconds** and include the 50-test scroll suite covering the single most
revert-prone area of the app. This is the highest-leverage fix available and it is a one-line change.

The config comment justifies the gate as _"opt-in due flaky browser harness in CI/local."_ That
justification does not survive measurement: across independent runs the suite produced **byte-identical
results every time** (2 failed / 73 passed, 13.5–16 s). It is deterministic, not flaky — and notably the
50 scroll tests, the ones the comment implicitly blames, passed on every run. Both failures are defects in
the tests themselves, which survived precisely because nothing runs them.

Meanwhile CI spends 1–2 minutes on `npx playwright install` (all three browsers, ~400 MB) for a workspace
it never instantiates.

**2. Scroll is the proven regression epicentre, and its excellent tests never run.**

The revert log is unambiguous:

```
6447035e  Revert "Fix scroll stability during mid-turn content collapse…(#2427)"
7e119e7a  Reapply "…(#2427)"
759b36a0  Revert "…(#2427)"
09eb129c  Fix scroll stability… (#2427)
ffa7f162  Revert "Fix thinking-block collapse and Safari layout shifts (#2426)"
b0e053c7  Revert "perf(chat): cap mobile memory with content-visibility (#2391)"
f98711a7  Revert "fix(chat): drop ChatGPT-style scroll pin on mobile (#2381)"
```

`#2426` landed and was reverted. `#2427` landed, was reverted, reapplied, and reverted again. **HEAD
contains neither fix.** Meanwhile `src/lib/utils/scroll/__tests__/harness.ts` (314 lines) is the best test
infrastructure in the repo — real DOM, real rAF cadence matched to the token buffer, three distinct input
modalities, a `PerformanceObserver` CLS probe, and a deterministic RNG for fuzzing. It has never gated a
merge.

**3. Nominal module coverage is 11%, and the untested modules are the complex ones.**

36 of 310 source modules have a same-named test file. Zero coverage on, among others:

| Module                                                | LOC  | What it is                                |
| ----------------------------------------------------- | ---- | ----------------------------------------- |
| `src/routes/conversation/[id]/+server.ts`             | 843  | The streaming generation endpoint         |
| `src/lib/server/textGeneration/mcp/runMcpFlow.ts`     | 778  | Tool-calling orchestration, 10-round loop |
| `src/lib/server/textGeneration/mcp/toolInvocation.ts` | 349  | Parallel tool execution + ordering        |
| `src/lib/utils/markdownWorkerPool.ts`                 | 291  | Worker pool, death recovery, CSP fallback |
| `src/lib/server/models.ts`                            | ~410 | Model registry, overrides, Omni alias     |
| `src/lib/server/router/*`                             | 478  | Every routing decision                    |

No coverage tooling (v8/istanbul) is configured at all.

**4. The test suite makes live network calls to `router.huggingface.co` on import.**

`src/lib/server/models.ts:392` is a top-level `await buildModels()` guarded only by `building`. Under
Vitest `building` is `false`, so any spec that transitively imports `$lib/server/models` — which
`api/v2/user/settings/+server.ts` and `api/v2/models/+server.ts` both do — fetches the live HF router
with no API key. This is what the 30-second `testTimeout` is papering over: individual tests measured at
3–5 s (`"returns user info for authenticated user" 3126ms`). CI reliability currently depends on a
third-party endpoint being reachable and not rate-limiting.

**5. There is no schema-evolution safety net.** `src/lib/migrations/routines/index.ts:15` is
`export const migrations: Migration[] = []` — emptied by `3fcdc940`. The architecture doc
(`docs/source/developing/architecture.md:39`) states "Any schema changes must include a migration"; that
contract is currently unenforced, and the migration _runner_ itself has no tests.

### Recommendation

Three tiers, built in this order, with **Phase 0 delivering most of the value in under a day**:

| Tier            | Runner                             | Volume target     | Runtime budget | Role                                                                  |
| --------------- | ---------------------------------- | ----------------- | -------------- | --------------------------------------------------------------------- |
| **1 — Node**    | vitest, `environment: node`        | ~70% of tests     | < 90 s         | Pure logic, protocol contracts, server integration on in-memory Mongo |
| **2 — Browser** | vitest browser mode, real Chromium | ~25%              | < 60 s         | Layout, CSS, DOM, workers, components                                 |
| **3 — E2E**     | Playwright, Chromium + **WebKit**  | ~5% (30–50 specs) | < 5 min        | Full-stack flows, cross-engine, backwards-compat corpus               |

I verified Tier 3 is practical: a 90-line mock OpenAI server plus chat-ui's existing in-memory Mongo
fallback boots a working app in **5 seconds** and completes a full streaming conversation. Details in §6.

---

## Part 1 — Functionality map

### 1.1 Architecture

SvelteKit 2 + Svelte 5 (runes) + MongoDB + Tailwind 4. Speaks exclusively to OpenAI-compatible APIs via
`OPENAI_BASE_URL`. 67 route files, 84 components, 43 test files.

```
Request → hooks.server.ts (auth, CSRF, CORS, admin gate, mutation block)
        → route handler
        → textGeneration() ─┬─ runMcpFlow()  (tools path, ≤10 rounds)
                            └─ generate()    (default path)
                                 └─ endpointOai → OpenAI SDK → upstream
        → MessageUpdate stream (NDJSON) → client
        → persistConversation() → MongoDB
```

### 1.2 Feature inventory

| Area               | Key modules                                                            | Notes                                                                                                  |
| ------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Chat streaming** | `textGeneration/`, `endpoints/openai/`, `conversation/[id]/+server.ts` | NDJSON wire format, not SSE. Tokens `padEnd(16,"\0")`; 4096-space flush after `FinalAnswer`            |
| **Message tree**   | `utils/tree/`                                                          | Flat array + denormalised full `ancestors` paths. Branch/retry = siblings                              |
| **Reasoning**      | `textGeneration/reasoning.ts`, `generate.ts`                           | Three modes (`regex`/`summarize`/`tokens`) + provider `delta.reasoning` wrapped in synthetic `<think>` |
| **MCP tools**      | `server/mcp/`, `textGeneration/mcp/`                                   | HTTP+SSE transports, client pool, per-server tool cache, schema sanitisation, parallel execution       |
| **Router (Omni)**  | `server/router/`                                                       | **Local heuristic** — Arch-Router removed in `9e5c66d6`. Multimodal / tools / default routes           |
| **Artifacts**      | `utils/artifacts.ts`, `ArtifactPanel.svelte`                           | `<artifact>` protocol, version registry, line diff, sandboxed preview, HF Space deploy                 |
| **Markdown**       | `utils/marked.ts`, `markdownWorkerPool.ts`, `markedLight.ts`           | Worker pool (≤2), KaTeX + hljs, SSR fallback path, block LRU cache                                     |
| **Scroll**         | `utils/scroll/`                                                        | Position-based attribution, spring animation, spacer, `overflow-anchor` management                     |
| **Auth**           | `server/auth.ts`, `hooks/handle.ts`                                    | OIDC + PKCE, anonymous sessions, Bearer tokens (`/api/**` only), trusted-header, admin CLI             |
| **Persistence**    | `server/database.ts`, `migrations/`                                    | 16 collections, GridFS attachments, TTL indexes                                                        |
| **Sharing**        | `conversation/[id]/share/`, `r/[id]/`                                  | `nanoid(7)` ids, blob copying, social thumbnails                                                       |
| **API**            | `routes/api/v2/**` (superjson), `routes/api/**` (plain JSON, legacy)   | Two wire formats; v1 is an external iOS-client contract                                                |

### 1.3 Behavioural contracts a regression would silently break

Extracted during mapping — these are the assertions a suite should encode.

**Stream protocol**

- Each chunk is exactly one `JSON.stringify(update)` + `"\n"`; no un-escaped interior newline.
- Client carry-over (`messageUpdates.ts:148` `parseMessageUpdates`) must reassemble JSON split across reads.
  On `SyntaxError` it keeps only `inputs.at(-1)` — two malformed lines in one chunk silently drop
  everything between. **Zero tests, exercised on every generation.**
- Stream tokens are `\0`-padded on the wire and must be stripped client-side.

**Ordering**

- `Status/Started` first; `FinalAnswer` before `Status/Finished`.
- Tool `Call` + `ETA` for _all_ calls in a batch precede any `Result`/`Error` — the UI keys panels by `uuid`.
- `toolMessages` collate in **original call order** despite streaming in finish order
  (`toolInvocation.ts:333`). Breaking this desynchronises `tool_call_id` pairing and upstream returns 400.

**Abort** (three independent channels: in-process registry, per-request 300 ms DB poll, 500 ms global cache)

- Stop marker written **before** `AbortRegistry.abort()` (`stop-generating/+server.ts:44`).
- Pre-flight cleanup preserves markers younger than `STOP_MARKER_GRACE_MS` (5 s).
- Marker consumed only on `abortedByUser`; `clearInterval` + `unregister` on every exit path.
- Abort-error detection is duplicated in **four** places with four different predicates.

**Tree**

- `rootMessageId` set ⟺ every message has `ancestors` + `children`.
- `b.id ∈ a.children ⟺ b.ancestors.at(-1) === a.id` — nothing checks this.
- `addChildren` with an unknown `parentId` silently creates an orphan with a dangling ancestor, which makes
  every later `buildSubtree` throw (`addChildren.ts:31`).

### 1.4 Duplicated logic that will drift

Four places implement one rule twice. Each is a latent regression with no test pinning parity.

| Rule                               | Implementation A                        | Implementation B                                | Observed divergence                                                                                                                          |
| ---------------------------------- | --------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `FinalAnswer` merge when tools ran | `conversation/[id]/+server.ts:499-540`  | `conversation/[id]/+page.svelte:398-448`        | Client has whitespace-trimming variants and an `isInterrupted` branch the server lacks → **streamed text can differ from text after reload** |
| Router decision tree               | `router/endpoint.ts:167-278`            | `textGeneration/mcp/routerResolution.ts:30-113` | B ignores `LLM_ROUTER_ENABLE_MULTIMODAL`; A hard-throws where B soft-skips                                                                   |
| Settings zod schema                | `api/v2/user/settings/+server.ts:12-31` | `settings/(nav)/+server.ts:8-27`                | Byte-identical today; B has no `requireAuth`                                                                                                 |
| Tree mutation on send/retry        | `conversation/[id]/+server.ts:290-347`  | `conversation/[id]/+page.svelte:176-231`        | Independent `v4()` calls — optimistic client ids never match persisted ids                                                                   |

**Recommendation:** extract each to a shared pure function, unit-test it, and delete the duplicate. This is
cheaper than testing both sides and is the single best structural change for regression resistance.

---

## Part 2 — Current test suite: measured

### 2.1 Workspaces

`vite.config.ts` defines three:

| Workspace | Env                           | Include                      | Setup                                  | Runs by default?                        |
| --------- | ----------------------------- | ---------------------------- | -------------------------------------- | --------------------------------------- |
| `client`  | browser (Playwright/Chromium) | `**/*.svelte.{test,spec}.ts` | `vitest-setup-client.ts` — **0 bytes** | **No** — gated on `VITEST_BROWSER=true` |
| `ssr`     | node                          | `**/*.ssr.{test,spec}.ts`    | none                                   | Yes                                     |
| `server`  | node                          | `**/*.{test,spec}.ts`        | `vitest-setup-server.ts`               | Yes                                     |

### 2.2 Measured results

**Before Phase 0:**

```
CI=true npx vitest --run                        # server + ssr
  Test Files  37 passed (37)
       Tests  399 passed (399)
    Duration  18.53s

VITEST_BROWSER=true npx vitest --run --project=client
  Test Files  2 failed | 4 passed (6)
       Tests  2 failed | 73 passed (75)
    Duration  15.96s
```

**After Phase 0** (`npm run test:all`):

```
  Test Files  43 passed (43)
       Tests  494 passed (494)
```

Coverage baseline, node workspaces only (`npm run test:coverage`):

```
Statements   : 17.2%  ( 3645/21182 )
Branches     : 71.62% (   954/1332 )
Functions    : 48.93% (   252/515  )
```

The whole suite is fast; there is no runtime argument against expanding it.

### 2.3 Harness assessment

**`vitest-setup-server.ts`** — loads `.env` from the repo root (hard-fails if absent), splits `PUBLIC_*`
from private, `vi.mock`s both `$env` modules, and spawns a **real `MongoMemoryServer`** inside the
`$env/dynamic/private` mock factory. The DB is genuinely real; only env is mocked. Good design.

Problems:

- **One mongod per test file** (Vitest isolates module graphs) — ~15 processes per run. Dominant cost.
- Standalone, no replica set → transactions and change streams are untestable.
- `MONGODB_URL` is overwritten unconditionally, so there is no way to point the suite at a real mongod.
- Specs import handlers directly and call them with hand-built `{locals, url, params, request} as never`.
  **The `handle` hook is never exercised** — no test covers CORS, CSP, the CSRF origin check, the global
  401-on-mutation rule, cookie refresh, admin Bearer gating, or the OAuth redirect allowlist.
- `cleanupTestData()` (`__tests__/testHelpers.ts:78`) misses `messageEvents`, GridFS, `semaphores`,
  `migrationResults` — latent cross-test pollution and a rate-limit flake risk.
- Only 3 of 13 DB-touching specs `await ready`; the rest work by timing accident. This is the likely root
  of `migrations.spec.ts:10`'s `retry: 3`.
- Index creation is fire-and-forget (`database.ts:170` is not `async`), so `await ready` does not guarantee
  indexes exist. Two workarounds already exist in-tree, which is the tell. I observed the symptom directly
  during my run: `MongoServerError: Index build failed … interrupted at shutdown`.

**`vitest-setup-client.ts` is empty.** Consequently any component importing `$app/state`, `$app/paths`,
`$app/navigation`, or reading Svelte context **cannot currently be mounted** — that is `ChatMessage`,
`ChatWindow`, `ChatInput`, `ToolUpdate`, `ArtifactPanel`, `UploadedFile`. This is the blocker for Tier 2.

### 2.4 CI reliability hazards

Three ways the suite can fail for reasons unrelated to the code under test:

1. **Cold-cache mongod race.** With ~15 workers each calling `MongoMemoryServer.create()`, a fresh runner
   has them all racing to download and lock the same 164 MB binary. This was reproduced: three suites died
   at collection time with `Cannot unlock file "~/.cache/mongodb-binaries/7.0.14.lock", because it is not
locked by this process`. It did not recur once cached. **CI has no mongodb-binaries cache step** — only
   `cache: "npm"`. This is a live flake source on every cache miss.
2. **Live network at import.** `models.ts:392` fetches `router.huggingface.co` (§0.4).
3. **Live DNS.** `isURLLocal.spec.ts` resolves third-party wildcard services (`nip.io`, `sslip.io`) plus
   `huggingface.co`. It fails offline and in network-restricted runners.

The 30 s timeouts are a symptom of (1), not a tuning choice. Hoisting a single `MongoMemoryServer` across
the project would let them come down and would eliminate the lockfile race class entirely.

### 2.5 Quality highlights and lowlights

**Best in repo:** `scroll/__tests__/harness.ts` + its two suites (50 tests), `artifacts.spec.ts` (50),
`messageUpdates.spec.ts` (24, with `_internal` clock injection — a deliberate testability seam),
`featureAnnouncements.spec.ts` (13, thorough), `stopTruncation.spec.ts` (full branch coverage).

**Structural strengths worth preserving.** Only **3 `vi.mock` calls exist in the entire 43-file suite**
(all in `tools.test.ts`, and well-built — a hoisted in-memory fake that records call sequences so cache
assertions check observed behaviour). The suite is overwhelmingly real-code against a real database. That
is its defining quality and the expansion should not dilute it. Suite hygiene is also clean: 0 snapshots,
0 `.skip`/`.only`/`.todo`, 0 mock-call-only assertions, one `{retry: 3}` band-aid.

**Tests that don't test what they claim:**

| Test                                 | Problem                                                                                                                                                                                                                                       |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ToolCallsSummary.svelte.test.ts:60` | Asserts on a function object, not its result. **Fails.**                                                                                                                                                                                      |
| `template.spec.ts`                   | 4 tests named for engine-selection behaviour `compileTemplate` never implements (it always tries Jinja, falls back on throw). **Two test bodies are byte-identical.**                                                                         |
| `migrations.spec.ts:66`              | `.not.toBe()` on two `Date` objects — reference equality, always passes. Combined with `{retry: 3}`, `refreshLock` is effectively untested.                                                                                                   |
| `misc.spec.ts:62`                    | Public-config test asserts only `typeof data === "object"`, which `{}` satisfies. It does not assert that server-only keys are excluded — the entire point of the endpoint.                                                                   |
| `addChildren.spec.ts:34`             | "should not let you create a message that already exists" actually trips the legacy-append guard. There is no id-collision check anywhere in the code.                                                                                        |
| `treeHelpers.spec.ts`                | 3 tautological `expect(insertedId).toBeDefined()`.                                                                                                                                                                                            |
| `conversations-id.spec.ts:214`       | Asserts the title becomes `"hiddenVisible Title"` — the handler strips `<think>` _tags_ but keeps the reasoning _content_, so hidden chain-of-thought leaks into persisted titles. The test locks this in as correct rather than catching it. |

**Type safety is disabled at the test boundary.** Handlers are invoked as `await GET({...} as never)`, so
TypeScript catches no handler-signature drift. A `RequestEvent`-shaped helper would restore it.

**No test factories.** `@faker-js/faker` is a devDependency used in exactly one file — `scripts/populate.ts`
— and by **zero tests**. All fixtures are fixed literals.

**Auth assertions are asymmetric:** 401 is asserted in 6 places, **403 in exactly one**
(`conversations-id.spec.ts:70`), despite `resolveConversation`'s 403 branch being reachable from
message-delete and stop-generating.

---

## Part 3 — Risk model

Ranked from evidence — revert history, churn, and complexity — rather than intuition.

### 3.1 Churn (last 500 commits, source files only)

```
63  src/lib/components/chat/ChatWindow.svelte
41  src/routes/conversation/[id]/+page.svelte
41  src/lib/components/chat/ChatMessage.svelte
31  src/routes/settings/(nav)/[...model]/+page.svelte
22  src/lib/server/textGeneration/mcp/runMcpFlow.ts
21  src/lib/server/textGeneration/utils/toolPrompt.ts
21  src/lib/components/chat/ChatInput.svelte
18  src/routes/conversation/[id]/+server.ts
18  src/routes/api/fetch-url/+server.ts
```

### 3.2 Risk register

| #   | Area                                      | Evidence                                                                                          | Tier  | Current coverage                        |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------------------- | ----- | --------------------------------------- |
| 1   | **Scroll / layout stability**             | 5 reverts; `#2427` reverted twice                                                                 | 2 + 3 | Excellent — **never runs**              |
| 2   | **Abort / stop-generating**               | ~12 fix commits, one revert-of-revert                                                             | 1 + 3 | Marker write only; consumption untested |
| 3   | **Client state & invalidation**           | 3 reverts (`#2318`, `#2321`, re-land `#2332`)                                                     | 3     | None                                    |
| 4   | **Streamed vs persisted text divergence** | Duplicated merge logic, whitespace variants                                                       | 1     | None                                    |
| 5   | **MCP tool orchestration**                | 22 changes to `runMcpFlow`; schema-sanitisation hotfix `82f616bb`                                 | 1     | `sanitizeJsonSchema` + cache only       |
| 6   | **Artifacts edit robustness**             | `7f00b3f6`, `57c2fb00` (swapped tags, lenient matching)                                           | 1 + 2 | Good (`artifacts.spec.ts`)              |
| 7   | **Model config / `max_tokens`**           | 5 truncation hotfixes                                                                             | 1     | None                                    |
| 8   | **Legacy conversation compat**            | `resolveConversation.ts:66` converts in memory only → **message ids are unstable across v2 GETs** | 1 + 3 | Pure fn only                            |
| 9   | **Auth / cookies / CSRF**                 | `72431108`, `87bff0a1`; `handle` hook untested                                                    | 1     | None                                    |
| 10  | **SSRF (`fetch-url`, MCP health)**        | `4e7ce752`, one revert; unauthenticated egress                                                    | 1     | `urlSafety.test.ts`                     |
| 11  | **Markdown worker pool**                  | `fbcf106e`, `91123d1f` (event-loop stalls)                                                        | 2     | None                                    |
| 12  | **Settings persistence**                  | Full-document `$set`; version skew silently resets fields                                         | 1 + 3 | Partial                                 |

### 3.3 Why scroll kept regressing

From `09eb129c`'s commit message, three interacting mechanisms: a spacer re-inflation that re-anchored the
sent message (~267 px measured), Safari's absent `overflow-anchor` (~350 px shove vs 0 on Chrome), and a
single-frame ~300 px collapse teleport. Every one is cross-engine, timing-ordered, and layout-dependent —
precisely the class the existing harness was built to pin, and precisely the class that unit tests in
jsdom cannot catch. The harness even has a simulated-Safari mode. **It has never gated a merge.**

This is the strongest argument for Tiers 2 and 3 including a real WebKit target.

---

## Part 4 — Test architecture

### 4.1 Placement rules

Decide once, apply mechanically:

| If the behaviour depends on…                         | Tier | Filename                              |
| ---------------------------------------------------- | ---- | ------------------------------------- |
| Nothing but inputs → outputs                         | 1    | `*.spec.ts`                           |
| MongoDB documents                                    | 1    | `*.spec.ts` (in-memory Mongo)         |
| An upstream LLM's response shape                     | 1    | `*.spec.ts` (scripted chunk fixtures) |
| Real layout, CSS, or geometry                        | 2    | `*.svelte.test.ts`                    |
| Real DOM APIs (clipboard, observers, workers, media) | 2    | `*.svelte.test.ts`                    |
| Svelte component rendering or interaction            | 2    | `*.svelte.test.ts`                    |
| Server + client + browser together                   | 3    | `e2e/*.spec.ts`                       |
| Rendering engine differences (Safari)                | 3    | `e2e/*.spec.ts`                       |

**Rule of thumb:** push down. A behaviour testable at Tier 1 must not be tested at Tier 3.

### 4.2 Tier 1 — Node

Three sub-categories:

**(a) Pure unit** — no setup, microseconds each. Extend existing patterns.

**(b) Server integration** — real in-memory Mongo, exercised through the `handle` hook rather than by
calling exported handlers directly. This closes the largest current gap.

**(c) Protocol/contract** — the highest-value new category. Drive `textGeneration()` with a scripted
async-iterable of `ChatCompletionChunk`s and assert the emitted `MessageUpdate` sequence. No network, no
mocking of internals, fully deterministic. Every invariant in §1.3 becomes an assertion.

```ts
// src/lib/server/textGeneration/__tests__/streamContract.spec.ts (sketch)
const chunks = [
	delta({ role: "assistant", content: "" }),
	delta({ content: "Hel" }),
	delta({ content: "lo" }),
	delta({}, "stop"),
];
const updates = await collect(textGeneration(ctxWith(fakeEndpoint(chunks))));

expect(types(updates)).toEqual([
	"status:started",
	"stream",
	"stream",
	"finalAnswer",
	"status:finished",
]);
expect(text(updates)).toBe("Hello");
```

**Prerequisite:** fix `models.ts:392` to skip the boot fetch under test —
`if (!building && import.meta.env.MODE !== "test")`, mirroring `config.ts:24`. Without this, Tier 1 stays
network-dependent.

### 4.3 Tier 2 — Browser

Real Chromium via Playwright, driven by vitest browser mode. Two prerequisites:

1. **Un-gate the workspace** and add `npm run test:client`; wire both into CI.
2. **Populate `vitest-setup-client.ts`** with `$app/state`, `$app/paths`, `$app/navigation` mocks and
   context providers for `"settings"`, `"publicConfig"`, `CONVERSATIONS_CONTEXT_KEY`, and the artifacts
   symbol. Ship a `renderWithApp()` helper so component tests are one line.

The scroll harness is the model: build a real DOM, drive it on the real frame cadence, assert observable
outcomes (position, CLS) rather than internals.

### 4.4 Tier 3 — Playwright E2E

Small, high-value, and **cross-engine**. Chromium + WebKit at minimum; WebKit is non-negotiable given the
Safari-specific revert history.

Stack (validated — see §6):

```
┌─ mock-openai (node, ~90 LOC) ── GET /v1/models, POST /v1/chat/completions
├─ chat-ui (vite preview) ─────── OPENAI_BASE_URL → mock, MONGODB_URL unset → in-memory
└─ Playwright ─────────────────── Chromium + WebKit
```

Anonymous sessions work (`locals.sessionId` substitutes for a user), so no OIDC is needed.

---

## Part 5 — Backwards compatibility

The user-stated goal is expanding features without breaking existing behaviour. Four mechanisms, none of
which exist today.

### 5.1 Golden document corpus

The real backwards-compat surface is **MongoDB documents written by older versions**. Persisted shapes
that must keep loading:

| Shape                                           | Where it still appears                                                         | Risk                                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Legacy conversations (no `rootMessageId`)       | `convertLegacyConversation` has 3 call sites with **inconsistent persistence** | `resolveConversation.ts:66` converts in memory only → fresh UUIDs minted on every v2 GET |
| `MessageFile` as `string[]`                     | Pre-migration-05 documents                                                     | Migration disabled                                                                       |
| `MessageUpdate` variants `webSearch`, `pending` | Pre-2024 documents                                                             | Migrations 04/06 disabled; current union won't parse them                                |
| `Report.assistantId` (vs `contentId`)           | Migration 10 disabled → both shapes coexist                                    | Indexes still target the old name                                                        |
| `AbortedGeneration` without `generationId`      | Documented as "absent for legacy stop requests"                                | Handled by `clampStoppedContent`                                                         |
| `Settings` missing later fields                 | `DEFAULT_SETTINGS` applies on insert only                                      | Full-document `$set` on every write                                                      |

**Proposal:** `src/lib/server/__fixtures__/legacy/*.json` — a versioned corpus of real historical documents.
Every corpus entry is asserted to (a) load without throwing, (b) render, and (c) survive a write-read cycle.
Add a fixture whenever a persisted shape changes; never delete one.

> **Note on enum values:** `MessageUpdateType`, `MessageUpdateStatus`, and `MessageToolUpdateType` are
> persisted as string literals inside `Message.updates`. Renaming any of them type-checks cleanly and
> silently breaks stored conversations. Pin the literal values in a test.

### 5.2 API contract snapshots

v1 (`/api/**`) is an external contract — `api/conversations/+server.ts:28` and its v2 counterpart both
carry `// legacy param iOS`. Divergences that are load-bearing:

- v1 returns a bare array; v2 returns `{conversations, hasMore}`.
- v1 `/api/user` returns a raw `ObjectId` for `id`; v2 returns `.toString()`.
- Malformed conversation id → v1 **500**, v2 **400**.
- Unauthenticated DELETE → v1 **200**, v2 **401**.

**Proposal:** snapshot the exact JSON shape of every v1 endpoint and every v2 endpoint separately. Treat a
v1 snapshot change as a breaking change requiring explicit sign-off.

> **Serialization hazard worth pinning explicitly.** superjson's `ObjectId` transformer is registered
> exactly once, at `src/lib/APIClient.ts:6`, and superjson's registry is a module singleton. In a real SSR
> process `+layout.ts` imports `useAPIClient`, so the transformer _is_ registered and v2 emits custom
> `"ObjectId"` annotations. In the vitest `server` project no spec imports `APIClient`, so `_id` falls
> through to `ObjectId.prototype.toJSON()` — a plain hex string. `conversations.spec.ts:49` asserts
> `_id.toString()`, which passes under **both** shapes and therefore cannot detect the difference. Any
> contract test must control registration explicitly.

### 5.3 Migration tests

Re-enabling any routine is currently an unguarded production change. Before that happens:

- Test the runner: `shouldRun`, `runEveryTime`, `runForHuggingChat` gating, the ongoing/success/failure
  state machine, and the fact that **a failed migration is never retried** (`migrations.ts:50` checks
  presence, not status).
- Assert re-run safety per routine. Migration 08 is **not** re-runnable — a second run sets every document
  lacking `featured` to `PRIVATE`, wiping all approvals.
- Note that `migrations.ts:87` opens a session and calls `withTransaction`, but the session is never passed
  to any operation, so **no operation joins the transaction**. There is zero atomicity today. Either wire
  the session through or delete the ceremony — and test whichever you choose.

### 5.4 Settings compatibility

Every POST is a full-document `$set` of the entire client store. A client on a stale bundle that omits a
field has it re-defaulted by zod and **overwrites the server value**. Test: old-shaped payload → new fields
preserved; new-shaped payload → old fields preserved.

---

## Part 6 — E2E feasibility: validated

I built and ran the stack rather than assuming it.

**Mock server** (~90 LOC) implementing exactly the surface chat-ui touches — `GET /v1/models`,
`POST /v1/chat/completions` (streaming + non-streaming). The full OpenAI call-site inventory is:

```
endpointOai.ts:150   openai.completions.create
endpointOai.ts:230   openai.chat.completions.create   (stream)
endpointOai.ts:250   openai.chat.completions.create
runMcpFlow.ts:482    openai.chat.completions.create   (stream)
runMcpFlow.ts:643    openai.chat.completions.create   (non-stream, tool-id recovery)
```

**Results:**

| Step                                                                      | Outcome                                                                                          |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Boot with `OPENAI_BASE_URL=http://localhost:8788/v1`, `MONGODB_URL` unset | **Up in 5 s**, healthcheck 200                                                                   |
| `GET /api/v2/models`                                                      | Both mock models loaded with correct capability flags                                            |
| `POST /conversation` (anonymous, no OIDC)                                 | Conversation created with system root message                                                    |
| `POST /conversation/:id` (multipart)                                      | **CSRF guard fired** — "Non-JSON form requests need to have an origin" (matches `handle.ts:137`) |
| Same with `Origin` header                                                 | Full NDJSON stream: `2×status`, `6×stream`, `finalAnswer`, `title`, `status`                     |
| `GET /api/v2/conversations/:id`                                           | Correct tree persisted: `system` → `user` → `assistant`, ancestors 0/1/2, 10 updates             |

Two things this surfaced that a written plan would have missed: the CSRF origin requirement, and that the
wire contract requires the **parent message id** in `data.id` (omitting it throws
`"You need to specify a parentId if this is not the first message"` from `addChildren.ts:18`, surfaced as a
500). Both belong in the e2e helper.

**Conclusion:** a fully hermetic, offline, deterministic e2e stack is straightforward. No external
services, no API keys, no network.

---

## Part 7 — Implementation plan

Estimates are engineer-days for someone familiar with the codebase.

### Phase 0 — Stop the bleeding · ~1 day · ✅ **done**

| #   | Task                                 | What shipped                                                                                                                                                                                                                             |
| --- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1 | Un-gate the browser workspace        | `VITEST_BROWSER` condition removed from `vite.config.ts`. `test` now pins `--project=server --project=ssr`; added `test:client`, `test:all`, `test:coverage`                                                                             |
| 0.2 | Add browser tests to CI              | `lint-and-test.yml` gained a "Tests (browser)" step; `playwright install` narrowed to `--with-deps chromium` (was pulling all three engines, ~400 MB, for a workspace that never ran)                                                    |
| 0.3 | Fix the two red tests                | Root cause was the **empty `vitest-setup-client.ts`** — no stylesheet in the browser workspace, so Tailwind size utilities were inert. Setup now imports `src/styles/main.css`                                                           |
| 0.4 | Kill the network dependencies        | `OPENAI_BASE_URL` pinned to an unroutable host and `GET /models` served from `src/lib/server/__fixtures__/models.ts` via a targeted `fetch` intercept; `isURLLocal.spec.ts` mocks `node:dns`                                             |
| 0.5 | Cache the mongod binary in CI        | `actions/cache` on `~/.cache/mongodb-binaries`                                                                                                                                                                                           |
| 0.6 | Add coverage reporting               | `@vitest/coverage-v8` + report-only config; baseline **17.2%** statements                                                                                                                                                                |
| 0.7 | Fix the three tests that cannot fail | `template.spec.ts` rewritten around real engine-selection behaviour; `migrations.spec.ts` now compares timestamps (was reference equality) and adds a wrong-owner case; `misc.spec.ts` now asserts the PUBLIC\_-only disclosure boundary |

Two things worth carrying forward:

- **`0.3` was misdiagnosed in this document's first draft** (recorded as a ResizeObserver race). The
  measurement is async, but the reason overflow never occurred was the missing stylesheet. Corrected in §0.
- **`src/lib/utils/template.ts` appears to be dead code**: no caller in `src/`, and its
  `@huggingface/jinja` import is not a declared dependency (it resolves transitively, so a hoisting change
  would break `npm run check`). The spec was rewritten to pin real behaviour, but deleting both files is
  probably the right call — flagged rather than done, since removing source is a judgement call.

**Outcome (measured):** 43 files / **494 tests green**, up from 399 running + 75 unrun. 76 browser tests now
gate every merge, including the 50-test scroll suite covering the most-reverted subsystem. CI no longer
depends on `router.huggingface.co` or third-party DNS, and no longer flakes on a cold mongod cache.
`GET /api/v2/user` dropped from ~3126 ms to ~1204 ms once the registry stopped hitting the network. Net CI
time is roughly neutral — the ~14 s browser run is offset by no longer installing two unused engines.

### Phase 1 — Tier 1 foundations · ~4 days

| #   | Task                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.1 | **Stream contract harness** — scripted `ChatCompletionChunk` fixtures + `collectUpdates()`; encode every §1.3 invariant                                                                                                  |
| 1.2 | **Extract the duplicated `FinalAnswer` merge** into one pure function; property-test it; delete both copies                                                                                                              |
| 1.3 | `parseMessageUpdates` — split-mid-JSON, malformed lines, the 4096-space pad, `\0` stripping                                                                                                                              |
| 1.4 | Abort lifecycle — marker consumption, grace window, interval cleanup, `emitInterruptedFinalAnswer`                                                                                                                       |
| 1.5 | Tree edge cases — unknown `parentId` orphan, root `children: undefined` asymmetry, shared `ancestors` reference, id collision; decouple tree specs from MongoDB                                                          |
| 1.6 | Router branch matrix — all branches of `endpoint.ts:167-278`; pin `resolveRouteModels` behaviour (note: `LLM_ROUTER_FALLBACK_MODEL` is **unreachable** whenever a `default` route exists, contradicting `README.md:132`) |
| 1.7 | `getModelOverrides` — one malformed entry currently drops **all** overrides silently                                                                                                                                     |

### Phase 2 — Server integration hardening · ~4 days

| #   | Task                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2.1 | **Route requests through the `handle` hook** — the biggest structural gap. Add a `testRequest()` helper                                          |
| 2.2 | CSRF, CORS, the global 401-on-mutation rule, admin Bearer gating, redirect allowlist                                                             |
| 2.3 | Fix `cleanupTestData()` (add `messageEvents`, GridFS, `semaphores`, `migrationResults`); make `await ready` explicit everywhere; drop `retry: 3` |
| 2.4 | v1 + v2 contract snapshots, with superjson registration controlled explicitly                                                                    |
| 2.5 | `serializeModel` security assertions — **no `endpoints` (API keys) or `parameters` may escape**                                                  |
| 2.6 | MCP: `toolInvocation` ordering/error/abort; `runMcpFlow` server merge, filter, and gate precedence                                               |
| 2.7 | GridFS lifecycle — upload/download/limits, the `output/[sha256]` auth branches                                                                   |
| 2.8 | SSRF regression pack for `fetch-url` and `/api/mcp/health`, including per-hop redirect revalidation                                              |

### Phase 3 — Tier 2 browser · ~4 days

| #   | Task                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 | **Populate `vitest-setup-client.ts`** + `renderWithApp()` helper — unblocks all component testing                                     |
| 3.2 | `ChatMessage` block assembly — table-driven over `{content, updates}` → expected render units                                         |
| 3.3 | `ChatMessage` copy semantics — `data-exclude-from-copy` stripping                                                                     |
| 3.4 | `CodeBlock` streaming sanitisation — the `NON_HIGHLIGHTER_TAG` DOMPurify bypass is an explicit security/perf tradeoff with zero tests |
| 3.5 | `OpenReasoningResults` open/close state machine, including the short-content (no-mask) case                                           |
| 3.6 | `ChatInput` submit semantics — Enter, Shift+Enter, IME composition, autosize                                                          |
| 3.7 | `Modal` contract — Escape, backdrop-click-with-selection, `#app[inert]`, nested-modal precedence                                      |
| 3.8 | `markdownWorkerPool` — worker death, CSP fallback, per-client coalescing, "never go silent"                                           |

### Phase 4 — Tier 3 E2E · ~5 days

| #   | Task                                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------- |
| 4.1 | Playwright config + fixtures; promote the validated mock server to `e2e/mock-openai.ts`; add a mock MCP server |
| 4.2 | Core flows — send/stream/persist/reload; branch and retry; edit a user message                                 |
| 4.3 | **Abort** — stop mid-stream, verify the clamped persisted text matches what was displayed, then reload         |
| 4.4 | **Navigation races** — navigate mid-stream, switch conversations, background generation handoff                |
| 4.5 | **Backwards-compat corpus** — seed legacy documents directly into Mongo, assert they render                    |
| 4.6 | Share → open share link → import; settings round-trip                                                          |
| 4.7 | **WebKit target** for the scroll/layout specs — the reverted bugs were Safari-specific                         |
| 4.8 | Tool-calling flow against the mock MCP server                                                                  |

### Phase 5 — Ratchet · ongoing

- Coverage thresholds that only ever rise.
- New persisted shape ⇒ new corpus fixture (enforce in review).
- New `MessageUpdate` variant ⇒ new contract-test case.
- Quarterly: prune tests that never fail and never would.

### Suggested sequencing

```
Phase 0 ██                                     ~1d   ← highest value/effort ratio by far
Phase 1     ████████                           ~4d
Phase 2             ████████                   ~4d
Phase 3     ████████            (parallel with 2)
Phase 4                     ██████████         ~5d
Phase 5                               ────────► ongoing
```

Phases 2 and 3 are independent and can run concurrently. Total ≈ 18 engineer-days for full build-out;
**Phase 0 alone captures a disproportionate share of the value.**

---

## Part 8 — Infrastructure changes

### 8.1 `vite.config.ts`

Remove the `VITEST_BROWSER` gate. Keep the three workspaces; they map cleanly onto the three tiers.

### 8.2 `package.json`

```jsonc
"test":          "vitest --run --project=server --project=ssr",
"test:client":   "vitest --run --project=client",
"test:e2e":      "playwright test",
"test:all":      "npm run test && npm run test:client",
"test:coverage": "vitest --run --coverage"
```

### 8.3 CI (`lint-and-test.yml`)

Add a browser step to the existing `test` job (Playwright is already installed) and a separate `e2e` job.
Keep the Docker `build-check` job as-is.

### 8.4 New files

```
e2e/
  mock-openai.ts            # promoted from the validated prototype
  mock-mcp.ts
  fixtures.ts               # Playwright fixtures: app + mocks + seeded Mongo
  *.spec.ts
playwright.config.ts        # projects: chromium, webkit
scripts/setups/
  vitest-setup-client.ts    # populate: $app mocks + context providers
src/lib/server/__fixtures__/
  legacy/*.json             # golden document corpus
  chunks.ts                 # scripted ChatCompletionChunk builders
src/lib/server/__tests__/
  testRequest.ts            # drive requests through the handle hook
  factories.ts              # faker-backed builders (currently zero test factories exist)
```

### 8.5 Source changes that materially improve testability

These are small refactors with outsized payoff. Each removes a whole class of regression.

1. `models.ts:392` — skip the boot fetch under test. **Blocks Phase 1.**
2. Extract the `FinalAnswer` merge to one shared pure function (§1.4).
3. Extract the router decision tree so `endpoint.ts` and `routerResolution.ts` share it (§1.4).
4. Extract the settings zod schema to one module imported by both endpoints (§1.4).
5. Export `parseMessageUpdates`, `parseServers`, `sanitizeName`, and `stripEmptyInitialSystemMessage` — all
   pure, all currently untestable because they are module-private.
6. Make `database.ts:initDatabase()` `async` and await index creation, so `ready` means ready.

### 8.6 Two harness changes worth doing early

**Hoist MongoMemoryServer.** One instance per project instead of one per file removes ~15 mongod spawns,
lets the 30 s timeouts come down, and eliminates the binary-lockfile race class (§2.4). Give each file its
own database name for isolation.

**Add a `RequestEvent`-shaped `testRequest()` helper.** Replacing `await GET({...} as never)` with a typed
helper that routes through the `handle` hook restores type-checking at the test boundary _and_ unblocks the
entire CSRF/CORS/auth-middleware test category in one move.

---

## Appendix A — Untested modules by risk

| Module                                       | LOC  | Tier  | Why it matters                                                          |
| -------------------------------------------- | ---- | ----- | ----------------------------------------------------------------------- |
| `routes/conversation/[id]/+server.ts`        | 843  | 1     | The generation endpoint. Stream framing, abort, persistence             |
| `textGeneration/mcp/runMcpFlow.ts`           | 778  | 1     | Chunk delta state machine, 10-round loop, `<think>` tracking            |
| `textGeneration/mcp/toolInvocation.ts`       | 349  | 1     | Parallel execution, ordering, hand-rolled queue                         |
| `utils/markdownWorkerPool.ts`                | 291  | 2     | Worker death, CSP fallback; failure = escaped plaintext for users       |
| `server/models.ts`                           | ~410 | 1     | Registry, overrides, Omni alias; silent all-or-nothing override drop    |
| `server/router/endpoint.ts`                  | ~285 | 1     | Every routing branch                                                    |
| `server/mcp/clientPool.ts` + `httpClient.ts` | ~250 | 1     | Reconnect, session expiry, retain/release vs sweeper race               |
| `components/chat/ChatWindow.svelte`          | 1063 | 2 + 3 | 9 `$effect`s, highest churn in repo                                     |
| `components/chat/ArtifactPanel.svelte`       | 772  | 2     | 7 interdependent `$effect`s                                             |
| `routes/conversation/[id]/+page.svelte`      | 808  | 3     | Client engine: stream consumption, tree, abort                          |
| `stores/settings.ts`                         | 171  | 1     | Shared `timeoutId` between `set` and `initValue` → silent settings loss |
| `migrations/migrations.ts`                   | ~117 | 1     | Runner; failed migrations never retry                                   |
| `utils/safeInvalidate.ts`                    | ~30  | 3     | Documents its own unhandled race                                        |

## Appendix B — Bugs found while mapping

Not test gaps — actual defects, surfaced by the audit. Worth triaging separately.

| #   | Location                                       | Issue                                                                                                                                                                                                              |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1  | `textGeneration/index.ts:82-99`                | `generate()` is called inside the `try`; a non-abort throw calls it **again** at `:97` → the model runs twice and a second answer is appended to already-streamed content. Also leaves `keepAlive` running forever |
| B2  | `mcp/tools.ts:294`                             | Collision loop can exit still-colliding; `mapping[plainName]` is overwritten unconditionally → a tool routes to a **different server's** tool                                                                      |
| B3  | `files/uploadFile.ts:8`                        | `sha256(await file.text())` hashes the text decoding, not the bytes → collisions on binary files. `arrayBuffer()` called twice; stored mime disagrees with returned mime                                           |
| B4  | `api/v2/export/+server.ts:15`                  | Self-serve data export requires `locals.isAdmin` — likely inverted                                                                                                                                                 |
| B5  | `api/v2/export/+server.ts:86`                  | `file.name.split("-")[1]` throws on any GridFS filename not matching `x-y`                                                                                                                                         |
| B6  | `database.ts:203`                              | Index declared on `message.id` / `message.ancestors` (singular) — dead index. `reports`, `settings`, `users` also index fields that no longer exist                                                                |
| B7  | GridFS                                         | Blobs are never deleted when a conversation is deleted — permanent orphans                                                                                                                                         |
| B8  | `migrations.ts:87`                             | `withTransaction` wraps operations that never join the session — zero atomicity, no error                                                                                                                          |
| B9  | `router/policy.ts:35`                          | `LLM_ROUTER_FALLBACK_MODEL` is unreachable when a `default` route exists, contradicting the README                                                                                                                 |
| B10 | `router/toolsRoute.ts:31`                      | `pickToolsCapableModel` never checks `supportsTools`                                                                                                                                                               |
| B11 | `marked.ts:238`                                | `addInlineCitations` regex-replaces `[1]` across rendered HTML **including inside code blocks**                                                                                                                    |
| B12 | `conversation/[id]/+server.ts:598`             | Once the client detaches, a full `messages` rewrite fires on **every subsequent token**                                                                                                                            |
| B13 | `messageUpdates.ts:63`                         | Client sends `is_continue`; the server zod schema omits it — silently stripped                                                                                                                                     |
| B14 | `api/v2/conversations/[id]/+server.ts` (PATCH) | Title sanitisation strips `<think>` **tags** but keeps the reasoning **content** → hidden chain-of-thought leaks into persisted, shareable titles. `conversations-id.spec.ts:214` asserts this as correct          |
| B15 | `utils/template.ts`                            | `compileTemplate` always attempts Jinja and falls back to Handlebars on throw; it never reads the engine selector its tests are named for. Either the impl or the tests are wrong                                  |
| B16 | `mcpValidation.ts:48`                          | `isPrivateOrLocalhost` misses IPv6 ULAs (`fc00::/7`) and decimal/hex-encoded IPv4. Client accepts `http:`, server requires `https:` — a user can add a server that is silently dropped later                       |

---

## Appendix C — Which existing suites to trust

When refactoring, these tell you where you have a real safety net and where you only appear to.

**Strong — treat as a genuine net, and copy their patterns**

| Suite                                           | Cases | Why it's good                                                                                                |
| ----------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------ |
| `scroll/__tests__/stickToBottom.svelte.test.ts` | 33    | Full must-NOT-detach gesture taxonomy, scroll-anchoring invariant, **80-op seeded fuzz with a shadow model** |
| `scroll/__tests__/chatScroll.svelte.test.ts`    | 17    | Fill→follow handoff, branch switch, intent expiry, CLS probe asserts 0                                       |
| `utils/artifacts.spec.ts`                       | 50    | Streaming tag parsing, fuzzy `old_str`/`new_str`, registry versioning                                        |
| `utils/marked.spec.ts`                          | 35    | XSS/sanitisation, streaming repairs vs non-streaming mirrors, block-id stability                             |
| `utils/parseIncompleteMarkdown.spec.ts`         | 25    | Repair plus explicit false-positive protection                                                               |
| `utils/messageUpdates.spec.ts`                  | 24    | Deterministic virtual clock via the `_internal` seam                                                         |
| `utils/sharePreviewText.spec.ts`                | 21    | Bidi/control-char stripping, NFC, cyclic-tree termination                                                    |
| `server/mcp/tools.test.ts`                      | 18    | The only well-built mocks in the repo — records call sequences, asserts observed behaviour                   |
| `utils/parseBlocks.spec.ts`                     | 14    | Char-by-char sweep asserting memoisation byte-equality                                                       |
| `utils/previewSrcdoc.svelte.test.ts`            | 3     | Real sandboxed iframe with sentinel-ordering proof of non-leakage                                            |

**Weak — rewrite rather than extend**

| Suite                                             | Problem                                                                |
| ------------------------------------------------- | ---------------------------------------------------------------------- |
| `utils/template.spec.ts`                          | Tests behaviour the implementation does not have; two identical bodies |
| `utils/tree/treeHelpers.spec.ts`                  | 3 tautological assertions                                              |
| `utils/tree/isMessageId.spec.ts`                  | 3 assertions, random `v4()` as the positive case                       |
| `api/__tests__/misc.spec.ts`                      | Public-config assertion cannot fail                                    |
| `components/chat/ToolCallsSummary.svelte.test.ts` | Malformed assertion; Tailwind `.mt-1` used as a behaviour proxy        |
| `textGeneration/utils/toolPrompt.spec.ts`         | `toContain` on prompt copy — a change-detector with low defect power   |
| `utils/tree/convertLegacyConversation.spec.ts`    | Verifies only the first 2 links of a 4-message chain                   |

## Appendix D — Commands

```bash
npm run test                                              # server + ssr  (37 files, 399 tests, ~19s)
VITEST_BROWSER=true npx vitest --run --project=client      # browser      (6 files,  75 tests, ~16s)
npx vitest run path/to/file.spec.ts
npx vitest --watch path/to/file.spec.ts
```
