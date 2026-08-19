# PRD — Agent Mode for chat-ui ("Code" toggle)

**Status:** Draft v1 · **Owner:** Product/Eng · **Date:** 2026-08-19
**Repo:** fork of [huggingface/chat-ui](https://github.com/huggingface/chat-ui) · branch `claude/agents-ui-chat-fork-0nd5js`

---

## 0. One-liner

Turn chat-ui into an **agents UI**: a single toggle in the composer switches a conversation from **Chat** to **Code** (agent mode). In Code mode, the conversation drives [pi](https://github.com/earendil-works/pi) — a coding agent running inside a Hugging Face sandbox — working on a Hugging Face-hosted repo (Space, model, or dataset), with live tool activity, diff review, approvals, and one-click publish back to the Hub. Same app, same sidebar, same message stream; the agent timeline is just a conversation whose messages happen to do things.

### Decisions at a glance

| Decision          | Choice                                                                                                                                                                                                                               | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent engine      | **pi** (`@earendil-works/pi-coding-agent`, MIT)                                                                                                                                                                                      | Minimal, self-extensible, exhaustively documented headless modes; built-in `huggingface` provider already targets `router.huggingface.co/v1`                                                                                                                                                                                                                                                                                                                                                              |
| Engine transport  | **`pi --mode rpc`** (JSONL over stdio) per session, bridged to a WebSocket by a tiny in-sandbox supervisor                                                                                                                           | pi RPC is the stable, versioned programmatic surface: streaming deltas, steering, abort, session tree ops, durable `get_entries {since}` resume cursor, and a bidirectional `extension_ui_request/response` channel for browser approvals. The sandbox exec API can't hold a persistent stdin, so a ~150-line "agent-server" bridges stdio ⇄ WS and journals events. pi's CBOR remote-session stack (`pi-server`/`pi-client`) is the future replacement once it stabilizes — watch, don't build on it yet |
| Execution runtime | **HF Sandboxes** (dedicated, per-session — they're HF Jobs running the open-source `sbx-server`), local Docker fallback runs the same binary                                                                                         | Isolation _is_ the permission model (pi has none by design); ~6–9s cold start, `cpu-basic` at $0.01/h, stateless HMAC auth so any app replica can reattach; the sandbox doubles as the off-pod runner chat-ui lacks for long-running work. No JS SDK exists — we write a ~200-line TS client against the documented wire protocol                                                                                                                                                                         |
| Code hosting      | **HF Hub repos** (Spaces first) via user OAuth (`contribute-repos` scope)                                                                                                                                                            | `@huggingface/hub` + token plumbing + deploy-to-Space already exist in chat-ui                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Browser transport | **Existing chat-ui streaming spine** — `MessageUpdate` JSONL POST + durable `generationEvents` log + SSE reattach                                                                                                                    | Already provides persistence, cross-tab resume, sidebar liveness, abort; agent events become new `MessageUpdate` types and inherit all of it. No browser-facing WebSockets in v1 — the only WS hop is server ⇄ sandbox, internal                                                                                                                                                                                                                                                                          |
| UI components     | Reuse chat-ui (tool cards, reasoning, markdown, ArtifactPanel); port the gaps from **AI Elements** (Apache-2.0) via its MIT **Svelte port** (bits-ui-based); **beautifului.dev** + **elements.ai-sdk.dev** as design/spec references | Smallest new surface; everything maps to bits-ui primitives chat-ui already ships                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Model access      | pi points at the **same OpenAI-compatible endpoint** (HF router); default: relay LLM traffic through a chat-ui endpoint with per-session credentials                                                                                 | One model registry, one billing path (`X-HF-Bill-To`), and the user's real token never enters the sandbox                                                                                                                                                                                                                                                                                                                                                                                                 |

---

## 1. Background

**chat-ui today** is a SvelteKit 2 / Svelte 5 chat app for OpenAI-compatible endpoints: message-tree conversations, MCP tool calling with streamed tool cards, reasoning display, artifacts with versioned diffs and deploy-to-Space, HF OAuth with server-side user tokens, and a durable generation-event log with SSE resume. What it cannot do: execute code, touch a filesystem, run git, or keep an agent alive beyond one HTTP request on one pod.

**pi** is an MIT coding agent harness (93k★, weekly releases): 4 default tools (`read`, `bash`, `edit`, `write`), deliberately no built-in MCP/permissions/plan-mode — everything is TypeScript extensions. It streams every event, supports mid-run steering, auto-compaction, JSONL session trees with fork/branch/resume, and ships headless modes designed to be driven by another program. Its own docs state the security boundary must be a container — which is exactly the role HF Sandboxes play. The sibling project `pi-chat` (chat frontends driving pi inside microVMs) proves the pattern we're building.

**The thesis:** chat-ui already contains ~70% of an agents UI — the streaming, persistence, resume, tool rendering, diff, and Hub plumbing. The remaining 30% is (1) a sandboxed runtime with pi in it, (2) a bridge translating pi's RPC events into chat-ui's `MessageUpdate` stream, and (3) a handful of specialized timeline components (terminal output, file diff, plan, approval). We should build exactly that and nothing else.

---

## 2. Product principles

1. **One toggle, not a new app.** Code mode is a property of a conversation, not a separate product. Same sidebar, same composer, same share links, same settings. If a screen needs a manual, we failed.
2. **The timeline is the product.** Everything the agent does — shell commands, edits, plans, questions — renders as blocks in the conversation, exactly like MCP tool calls do today. No IDE cosplay: review the diff, not the file tree.
3. **Reuse first.** New UI is built only where chat has no equivalent (terminal output, diffs, plan, approvals, workspace panel). Every new component uses bits-ui + existing chat-ui conventions.
4. **Safe by construction, autonomous by default.** Inside the sandbox the agent runs free — that's what the sandbox is for. Crossing the boundary (git push, deploy, secrets, off-sandbox network where policy applies) requires explicit user approval. No permission-prompt fatigue for `ls`.
5. **Everything survives.** Closing the tab, switching devices, a pod restart mid-run — the session resumes. pi's session file in the sandbox is the source of truth; Mongo mirrors it for rendering and history.
6. **The Hub is the workspace.** Repos come from and return to huggingface.co. A finished session ends in a commit, a Space you can open, or a Hub PR — an artifact with a URL, not text in a scrollbox.

---

## 3. Users & core journeys

**Users:** HuggingChat users who want to _make_ things (Spaces, scripts, datasets, model cards) without a local setup; developers who want a Claude-Code-class agent with HF models; self-hosters who want an open agents UI on their own endpoint.

- **J1 — Quick task, blank workspace.** Toggle Code → "write a script that benchmarks these 3 models and plot the results" → agent scaffolds, runs, shows output and the plot → user downloads files or publishes as a Space. No repo picker needed; a workspace is created implicitly.
- **J2 — Work on an existing repo.** Toggle Code → pick `user/my-space` (or paste a Hub URL) → sandbox clones it → "fix the mobile layout and add dark mode" → agent edits, runs the dev server, user checks the preview panel and the diff → approve → commit+push (or open a Hub PR).
- **J3 — Idea to Space.** "Build me a leaderboard app for X" → agent scaffolds a Gradio/static Space in the workspace → live preview iframe → iterate by chatting → "ship it" → create repo + push + link to the running Space.
- **J4 — Long run, walk away.** Kick off a chunky task → close the laptop → sidebar dot shows _working_ from the phone → drop a steering message mid-run ("use polars, not pandas") → come back to a _needs-input_ approval → approve → done, outcome card with diff stat and links.
- **J5 — Review & control.** At any point: open the workspace panel → changed files with +/− stats → per-file unified diff → revert a file, or checkpoint-restore the whole workspace to a previous user-prompt marker.

---

## 4. Scope

### v1 ships

**Mode & lifecycle**

- Chat ⇄ Code toggle in the composer (per conversation, set at creation, visible mid-thread); `mode` on the conversation, badge in the sidebar.
- Session setup block (first message in a Code conversation): workspace source — _blank_ | _HF repo picker_ (own repos + paste URL, branch) — model, autonomy level. Defaults chosen so J1 requires zero configuration.
- Sandbox lifecycle states surfaced honestly: _provisioning_ (checklist), _working_, _waiting for you_, _idle_, _expired_ (with one-click "resume in new sandbox" via pi session restore). Messages typed during provisioning queue and send when ready.

**Agent timeline** (specialized `MessageUpdate` renderers on the existing block system)

- Shell command card: command + collapsed ANSI output, exit-code badge, duration; streaming tail while running.
- File-edit card: path + mini unified diff (reuses the artifact line-differ); create/delete variants.
- Read/search/ls: one-line chips, grouped like today's `ToolCallsSummary`.
- Plan/todo card: live checklist updated in place (pending / in-progress / done / error).
- Reasoning: existing collapsible, plus "thought for Ns" duration.
- Working shimmer that names the current action ("Running `npm test` — 12s"), not a generic spinner.
- Outcome card at run end: diff stat, commit/branch/PR/Space links, cost & token usage.

**Control**

- Approval card (blocking, inline): what the agent wants to do → Allow once / Always for this session / Deny — powered by pi's `extension_ui_request` round-trip. Autonomy presets: _Ask to act_ (edits & shell ask) / _Auto_ (free rein inside the sandbox, boundary actions ask — default) / _Full auto_ (only push/deploy ask).
- Stop (existing button → pi `abort`), steer mid-run (composer stays live; input becomes pi `steer`), queued follow-ups.
- Checkpoints: marker per user prompt; restore workspace to marker (git snapshot in sandbox). Conversation rewind reuses the existing message-tree branching.

**Workspace panel** (generalization of `ArtifactPanel`, same split-pane slot)

- Changed-files list with +/− stats → per-file read-only diff; open file (read-only viewer); revert file.
- Preview tab: iframe on the sandbox dev-server / built Space preview.
- Publish actions: commit & push, create repo, open Hub PR, deploy Space (reuses `DeployToSpaceModal` flow) — every publish is an approval.

**Platform**

- pi bridge service in the chat-ui server: sandbox provisioning, `pi --mode rpc` spawn/attach, event translation → `MessageUpdate`/`generationEvents`, approval routing, resume via `get_entries {since}` + `--session` respawn.
- LLM relay endpoint (OpenAI-compatible passthrough) with per-session ephemeral credentials, so sandboxes never hold the user's HF token; billing keeps flowing through `X-HF-Bill-To`.
- OAuth scope additions (`contribute-repos` or `write-repos`, `write-discussions`; `jobs` only in the user-billed variant) with the existing 403 → re-auth flow.
- Settings: default agent model, autonomy default, sandbox hardware/TTL tier (behind config), per-user usage limits; ops kill-switches (max concurrent sandboxes/user, max session wall-clock, spend caps).
- Sharing: existing share pages render Code conversations read-only (tool cards + diffs included).
- Self-host story: `SANDBOX_BACKEND=hf|docker`; Docker backend runs the same pi image locally.

### Non-goals (v1)

- No file-tree browser or in-app editor; no interactive user-facing terminal (display-only output).
- No hunk-level accept/reject editing (whole-file revert + checkpoints cover v1).
- No multi-pane drag-and-drop workspace, kanban/fleet orchestration, or parallel agents per conversation.
- No browser/computer-use, screenshot verification, scheduled runs, or automations.
- No GitHub as a first-class remote (Hub first; GitHub via `git remote` in the sandbox works but gets no UI).
- No browser-facing WebSocket layer (the server ⇄ sandbox WS is internal plumbing); no dependence on pi's experimental CBOR server stack.
- Chat mode changes: none. Zero regressions to the existing experience is a hard requirement.

---

## 5. System architecture

```
Browser ── existing JSONL POST / SSE reattach ──► SvelteKit server (chat-ui fork)
   ▲                                                   │
   │  MessageUpdate stream (extended union)            │  Agent Bridge (new)
   │  approvals, steer, stop                           │   • sandbox lifecycle (Jobs API)
   │                                                   │   • WS client + event translation
   │                                                   ▼  wss://<job>--49983.hf.jobs (HMAC)
   │                                        HF Sandbox (dedicated, per session)
   │                                          ┌──────────────────────────────┐
   └── workspace panel: diffs, preview ◄──────│ agent-server (supervisor)    │
        (reverse-proxied through server;      │   └─ pi --mode rpc (stdio)   │
         sandbox URLs are token-gated)        │      + chat-ui pi extension  │
                                              │ event journal (seq JSONL)    │
                                              │ repo checkout (Hub) · dev srv│
                                              └──────────────┬───────────────┘
                                                             │ OpenAI-compatible
                                                             ▼
                                       chat-ui LLM relay ──► HF router (user billing)
```

### 5.1 Engine integration (pi)

- One sandbox + one `pi --mode rpc` process per active Code conversation, supervised by **agent-server**: a ~150-line Node process baked into the image that spawns pi, bridges its stdio to a local WebSocket, and appends every event to an on-disk JSONL journal with sequence numbers (the replay source for reconnects). Node ≥ 22.19 in the sandbox image; pi pinned to an exact version; RPC schema wrapped in a single adapter module (pi is 0.x and moves weekly).
- A **chat-ui pi extension** (TypeScript, loaded via `-e`) is our integration point inside the engine: `tool_call` hook enforces the autonomy policy and raises `ctx.ui.confirm()` (→ browser approval card); emits structured plan/todo state; tags file edits with unified-diff payloads (`details.patch`); blocks boundary actions (push/deploy) unless approved. pi deliberately has no permission system — this extension _is_ ours, and the sandbox is the backstop.
- Model config: pi's built-in `huggingface` provider (already `router.huggingface.co/v1`) pointed at our relay via a `models.json` `baseUrl` override; model list mirrors chat-ui's registry (`supportsTools` models only); thinking level mapped from the existing reasoning-effort UI.
- Repo context: pi auto-loads `AGENTS.md`/`CLAUDE.md` from the checkout; project trust set explicitly (`-a` / `defaultProjectTrust`) since headless modes never prompt. pi implements the Agent Skills standard — Hub-distributed skills are a natural later extension.
- MCP: pi has no MCP client by design. v1 does not wire chat-ui's MCP servers into Code mode; phase 2 exposes them to pi as extension-registered tools through the bridge.

### 5.2 Event flow & persistence

- Bridge translates pi RPC events → new `MessageUpdate` types (see §8). The existing pipeline then does everything: JSONL stream to the live client, coalesced append to `generationEvents` (durable, seq-ordered, TTL), periodic materialization into the conversation doc, SSE reattach from any tab/device, sidebar liveness via the live-generations feed, abort via the existing registry.
- **Source of truth** for agent history = pi's JSONL session file in the sandbox (persisted volume / exported on idle); Mongo holds the render mirror + metadata. Resume after sandbox or pod loss: respawn `pi --mode rpc --session <file>`, reconcile with `get_entries {since:cursor}` — pi documents the entry id as a durable cursor across restarts. pi session trees map 1:1 onto chat-ui's message tree (retry/edit/branch keep working).
- Big outputs: tool output truncated in conversation docs (16MB Mongo cap), full logs in the TTL'd event log / GridFS; artifacts (plots, files) copied out of the sandbox into GridFS so history outlives the sandbox.
- The long-running-work gap in chat-ui (runs die with their pod) is closed structurally: the model loop lives in the sandbox, not the web pod. A pod restart drops the pipe, not the run; the bridge re-attaches or respawns-with-resume, and `is_continue` semantics already exist client-side.

### 5.3 Runtime (HF Sandboxes)

HF Sandboxes are HF Jobs running `sbx-server` (open-source static binary, port 49983) behind the Jobs proxy at `https://<job_id>--49983.hf.jobs`, authenticated by `Authorization: Bearer <hf_token>` + `X-Sandbox-Token` (HMAC derived from the _creating_ token — stateless, so any app replica holding the same token can reattach). Exec streams NDJSON; the filesystem persists between execs; detached background processes survive across calls; the proxy forwards HTTP, SSE, **and WebSocket upgrades**. Cold start ≈ 6–9s (no snapshot/resume exists); default idle timeout 10 min (configurable), **24h hard max lifetime**; billed per minute (`cpu-basic`: 2 vCPU/16GB at $0.01/h, GPU flavors available).

- **Mode:** dedicated sandbox per session. Pool mode is disqualified: same-user trust only and no TCP port binding (no dev servers).
- **Client:** no JS SDK exists (`huggingface_hub` Python only) — we implement a thin TS `SandboxDriver` (~200 lines) against the documented wire protocol: create via the Jobs API (image, expose 49983, HMAC secret, labels incl. our `chatui-conv=<id>`), then `/v1/exec`, `/v1/files/*`, `/v1/processes`, proxy URLs.
- **Image:** prebaked `node:22-slim` + git + ripgrep + pi (pinned) + our extension + agent-server, so cold start stays ~6s + clone + deps; dependency install dominates — mitigate with a bucket-volume npm cache or per-template images before resorting to warm pools (1–3 idle `cpu-basic` boxes cost ~$0.24/day each if we want them).
- **Channel:** first exec clones the repo and starts agent-server detached; the bridge connects to `wss://…/v1/proxy/7000/ws` with the HMAC headers. Degraded mode: poll the journal via `files/read` offsets — same event log, no WS.
- **Idle economics (critical):** a running background process _suppresses_ the idle timeout — agent-server must self-terminate after N minutes with no client and no active turn so `idle_timeout` (~20–30 min) can reclaim the VM; a scheduled sweep kills anything unclaimed by label. Worst case per runaway sandbox is bounded by the 24h cap.
- **Expiry & resume:** before idle death or the 24h cap, persist pi's session JSONL + uncommitted work (push a WIP session branch to the Hub, or a read-write bucket volume); "resume" provisions a fresh sandbox, restores the checkout and session file, and pi continues via `--session`. TTL, hardware tier, and per-user concurrency are config.
- **Preview:** `*.hf.jobs` URLs are token-gated — a browser cannot open them directly. The workspace panel's Preview tab hits a SvelteKit route (`/preview/<conv>/…`) that reverse-proxies to the sandbox dev-server port, injecting the auth headers (incl. WS upgrade for HMR). The _public_ URL story is deploying the Space itself (§5.4).
- **Self-hosted fallback:** `sbx-server` runs in any x86_64 image, so the local backend is `docker run -p 127.0.0.1:0:49983 -e SBX_TOKEN=… <image>` speaking the **identical protocol** — one driver interface, two trivial impls, previews proxied the same way.

### 5.4 Repos & publishing (HF Hub)

- **Identity split (recommended):** sandboxes are created and driven under the **app's service token** — stable, so the HMAC-derived sandbox auth never breaks (user OAuth tokens rotate ~8h, which would orphan a running sandbox), billing is centralized and sweepable. The **user's OAuth token** is used for repo operations so commits/PRs are attributed to them. A user-billed variant (OAuth `jobs` scope creates the sandbox) is a documented alternative, accepting recreate-on-token-refresh.
- **Scopes:** add `contribute-repos` (least-privilege: create + access only app-created repos) or `write-repos`, plus `write-discussions` for Hub PRs, to `OPENID_SCOPES`; reuse the existing 403 → re-auth flow.
- **Clone:** server-side fetch seeding the sandbox, or a short-lived fine-grained token scoped to the one repo as the git credential. (OAuth tokens over git basic-auth are unverified — evidence negative; do not architect on it.)
- **Push/PR/deploy:** executed **by the server** with `locals.token` after explicit approval, via `@huggingface/hub`'s verified HTTP path — `createRepo`, `commit({operations, branch, isPullRequest})` (Hub PRs live at `refs/pr/N`; no forks needed). The sandbox hands the bridge a patch/bundle; the server commits it. `commit(..., isPullRequest: true)` is the review flow for repos the user doesn't own.
- Spaces are the flagship target: create → push → the Space builds and serves at its **public** `*.hf.space` URL — that's the shipped-artifact link in the outcome card; the sandbox preview tab covers the pre-publish loop.

### 5.5 Security model

- **Isolation:** all agent execution inside the sandbox; prompt-injection → arbitrary code in the sandbox is _assumed_ — so the sandbox must not contain anything worth stealing.
- **Credentials:** sandbox holds only (a) an ephemeral relay token scoped to this session's LLM calls, (b) optionally a short-lived, single-repo fine-grained credential. User OAuth token, service token, billing, and push rights stay server-side behind approvals. Sandbox ingress is itself token-gated (Jobs proxy + HMAC), so nothing inside is publicly reachable.
- **Boundary actions** (push, repo create, deploy, secret access) always confirm — even in Full auto.
- **Network policy** in the sandbox per settings (open by default for package installs; lockdown option for teams).
- **Abuse/cost:** per-user concurrent-sandbox and wall-clock caps, spend ceiling per session, kill-switch admin config (live `config` collection already supports runtime toggles).

---

## 6. UX specification

### 6.1 The toggle

A two-state segmented control — **Chat | Code** — in the composer, next to the existing model line / MCP chip (the MCP toggle is the established pattern in this spot). On a fresh conversation it sets the mode; mid-conversation it's shown but locked (mode is per-conversation; switching offers "start a Code conversation from here"). Feature-flagged (`feature-flags` endpoint) and wrapped for `isHuggingChat` vs self-host.

### 6.2 First-run & session setup

Toggling Code on a new conversation swaps the intro block for a **setup card**: workspace (Blank ▸ default | Pick a repo ▸ combobox of user's Hub repos + paste URL | branch), model (defaults to the agent route/coding model), autonomy (default _Auto_). One press of Enter with defaults must work (J1). While the sandbox provisions, the card becomes a live checklist (create sandbox → clone → start pi) and the composer queues input.

### 6.3 Timeline grammar

Order-preserving blocks inside the assistant message, exactly like today's think/tool blocks; when a run finishes, consecutive action blocks collapse into a summary row ("Ran 14 actions · 6 files changed") like `ToolCallsSummary`. Density toggle (Summary ↔ Verbose) is a v1.5 nice-to-have.

| Agent event               | Block                 | Notes                                                                                      |
| ------------------------- | --------------------- | ------------------------------------------------------------------------------------------ |
| `bash`                    | Terminal card         | cmd, streamed ANSI tail, exit badge, duration; collapse on success, auto-expand on failure |
| `edit`/`write`            | Diff card             | path chip + unified mini-diff; click → workspace panel                                     |
| `read`/`grep`/`find`/`ls` | Chip row              | grouped, one line each                                                                     |
| plan/todo updates         | Plan card             | single card updated in place                                                               |
| thinking                  | Reasoning collapsible | existing component + duration                                                              |
| `extension_ui_request`    | **Approval card**     | blocking; resolution recorded in transcript                                                |
| ask/notify                | Question/notice block | agent questions render as normal assistant text + focus the composer                       |
| run end                   | Outcome card          | diff stat, links (commit/PR/Space), tokens & cost                                          |

### 6.4 Workspace panel

The `ArtifactPanel` slot, generalized: tabs **Changes** (files + diffs, revert-file), **Preview** (iframe when a dev server / Space build exists), **Files** (flat read-only viewer, no tree in v1). Header carries sandbox status, checkpoint restore, and the Publish menu (commit & push / create repo / open PR / deploy Space). Panel is closed by default in J1-style sessions and auto-opens on first file change.

### 6.5 Control surfaces

- **Composer while running:** stays enabled; placeholder "Steer the agent…"; Esc/Stop aborts (existing); sends become `steer` (delivered at the next turn boundary) with a small "queued" chip.
- **Approvals:** inline card + browser notification when the tab is hidden; sidebar dot flips to _needs input_. Timeouts fall back to Deny after N minutes with a resumable prompt.
- **Sidebar:** existing conversation list; Code conversations get a mode glyph + status dot (working / needs input / done / failed) driven by the existing live-generations feed.
- **Usage:** small context/usage indicator in the composer (context %, cost on hover) fed by pi's per-message usage + session stats.

### 6.6 Component sourcing

| Need                                                            | Source                                                                                                                                                                                        |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tool/terminal/diff/plan/approval/checkpoint/queue/context cards | Port from **Svelte AI Elements** (MIT, bits-ui + Tailwind + Svelte 5) where available; upstream **AI Elements** (Apache-2.0) is the canonical state/prop spec; restyle to chat-ui conventions |
| Terminal ANSI rendering                                         | `ansi_up`-class lib + existing `CodeBlock` chrome                                                                                                                                             |
| Diff rendering                                                  | existing `artifactDiff.ts` line differ, upgraded to unified-diff input (pi emits `details.patch`)                                                                                             |
| Markdown/code/reasoning/scroll/stop/attachments/share           | chat-ui as-is                                                                                                                                                                                 |
| Visual craft reference                                          | beautifului.dev (tool chips, thinking states, approval cards), AI Elements demos                                                                                                              |

Everything above maps onto bits-ui primitives already in the app (Collapsible, Tabs, DropdownMenu, Dialog, LinkPreview); no new UI framework dependencies.

---

## 7. Configuration & settings

- **Env (self-host):** `SANDBOX_BACKEND=hf|docker`, sandbox image ref, TTL/hardware tier, `AGENT_MODEL` default or an `agentic` route in the existing router routes.json, relay on/off, network policy.
- **User settings (new fields, existing settings pipeline):** default mode for new conversations, agent model override, autonomy default, always-allow list (per session-scope), preview auto-open.
- **Admin/live config:** kill-switch, per-user caps, allowed hardware tiers — via the existing runtime `config` collection.

## 8. Data model changes (Mongo)

- `Conversation`: `mode: "chat" | "agent"`, `agent: { workspace: {kind: blank|repo, repoId, branch}, sandboxId, sandboxState, piSessionId, autonomy, checkpoints[], outcome? }` (patterned after the existing `deployedSpaces`).
- `MessageUpdate` union additions: `AgentTool` subtypes (`bash`, `patch`, `fileChip`), `Plan`, `Approval` (request/resolution), `Checkpoint`, `Outcome`, `SandboxStatus` — wire + persistence + resume come free from the existing spine.
- New collection `agentEvents` only if `generationEvents` TTL (24h) proves too short for session history; otherwise extend TTL for agent runs and archive pi JSONL to GridFS on sandbox expiry.
- `Settings`: fields per §7. `ConvSidebar`: `mode` + `status`.

## 9. Milestones

- **M0 — Spike (1–2 wks).** The TS `SandboxDriver` + agent image + agent-server, with pi driven over RPC from a script: create sandbox → clone → prompt → events over WS → steer → approval round-trip → kill → resume in a fresh sandbox. Settles the open verifications (§11.2) and real timings. _Demo: terminal-cast of a full loop._
- **M1 — The loop in the UI (3–4 wks).** Toggle + setup card (blank workspace only), bridge service, event translation, terminal/diff/plan blocks, stop/steer, sandbox lifecycle happy path. _Demo: J1 end-to-end in the browser._
- **M2 — Repos & review (3–4 wks).** Hub repo picker + clone/push/PR/deploy with approvals, workspace panel (changes/diff/revert, preview), checkpoints, outcome card, OAuth scope flow. _Demo: J2 + J3._
- **M3 — Durable & polished (3–4 wks).** Reconnect/resume across pod+sandbox loss, queued messages during provisioning, sidebar status + notifications, usage meter, share pages, Docker backend, limits/kill-switches, load & red-team pass. _Demo: J4 + J5; beta flag on._
- **Post-v1 candidates:** MCP tools inside Code mode, density toggle, hunk-level review, inline diff comments → steering, Hub-distributed skills, migration to pi's CBOR server stack, parallel sessions dashboard.

## 10. Risks & mitigations

| Risk                                                                     | Mitigation                                                                                                                                                                                                   |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| pi is 0.x, weekly releases; RPC/experimental stacks may shift            | Pin exact version in the sandbox image; single adapter module owns the RPC schema; contract tests against `docs/rpc.md` fixtures                                                                             |
| Sandbox cold start hurts first-token feel                                | Prebaked image (~6s boot); dependency cache (bucket volume) since `npm install` dominates; provisioning checklist + queued composer make waiting legible; small warm pool ($0.24/day per idle box) if needed |
| Sandbox/pod disconnects mid-run                                          | Stateless HMAC reattach from any replica; agent-server journal + seq replay; pi session file + `get_entries` cursor resume; reaper marks stale runs honestly                                                 |
| Runaway sandbox spend (idle-timeout suppressed by background processes)  | agent-server self-terminates when no client + no active turn; labeled-job sweep kills unclaimed boxes; 24h hard lifetime bounds worst case                                                                   |
| OAuth token rotation orphans sandbox auth (HMAC bound to creating token) | Identity split: sandboxes owned by stable service token; user token only for attributed repo ops                                                                                                             |
| 24h hard lifetime kills long sessions                                    | Session persistence (WIP branch / bucket volume) + fresh-sandbox resume is a first-class flow, not an error path                                                                                             |
| Token exfiltration via prompt injection                                  | Relay pattern: no user token in sandbox; boundary actions server-side behind approvals; scoped ephemeral credentials                                                                                         |
| Cost blowups (long loops, big models)                                    | Wall-clock & spend caps, context meter, compaction on by default, visible cost in outcome card                                                                                                               |
| Mongo doc bloat from tool output                                         | Truncate in-doc, full logs in TTL event log/GridFS (pattern exists)                                                                                                                                          |
| Scope creep toward IDE                                                   | Non-goals list is enforced; "review the diff, not the tree"                                                                                                                                                  |

## 11. Open questions

1. **Billing model:** platform-billed sandboxes (service account + product quotas, works for free users) vs. user-billed via the OAuth `jobs` scope (requires Pro/credits; accepts recreate-on-refresh) — product/pricing call; the architecture supports both.
2. **To verify empirically at M0** (docs-based today): OAuth tokens over git basic-auth (evidence negative — fallback paths specified), `jobs`-scoped sandbox creation with an `hf_oauth_` token, WS-through-proxy behavior under churn, real cold-start + install timings.
3. Blank-workspace persistence: hidden Hub repo (free durability + shareability) vs. sandbox-local only until first publish?
4. Does v1 expose model choice per Code conversation, or pin to the router's `agentic` route with override in settings only?
5. Naming: "Code" vs "Agent" as the user-facing toggle label (this doc says Code).
6. HuggingChat rollout: gated beta cohort size, hardware tier defaults, and abuse review before public flag.

---

## Source material

- **pi**: [repo](https://github.com/earendil-works/pi) · docs: `packages/coding-agent/docs/` (`rpc.md`, `sdk.md`, `session-format.md`, `extensions.md`, `security.md`, `containerization.md`) · reference deployment: [pi-chat](https://github.com/earendil-works/pi-chat) (chat frontends driving pi in microVMs)
- **HF Sandboxes**: [guide](https://huggingface.co/docs/huggingface_hub/main/guides/sandbox) · [concepts](https://huggingface.co/docs/huggingface_hub/main/concepts/sandbox) · [sbx-server](https://github.com/huggingface/sandbox-server) (wire protocol) · [capability writeup (gist)](https://gist.github.com/gary149/c859a3269c7bed464adac484dff58ee9)
- **HF Hub**: [@huggingface/hub](https://www.npmjs.com/package/@huggingface/hub) (already a chat-ui dependency) · [OAuth scopes](https://huggingface.co/docs/hub/en/oauth) · [Hub PRs (`refs/pr/N`)](https://huggingface.co/docs/hub/en/repositories-pull-requests-discussions)
- **UI**: [AI Elements](https://elements.ai-sdk.dev/) (Apache-2.0, canonical component/state spec) · [Svelte AI Elements](https://github.com/SikandarJODD/ai-elements) (MIT, bits-ui-based port) · [beautifului.dev](https://www.beautifului.dev/) (design craft reference) · [opencode server](https://opencode.ai/docs/server/) (reference client/server agent protocol)
