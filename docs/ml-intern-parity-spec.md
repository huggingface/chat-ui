# ML Intern parity in chat-ui / HuggingChat — gap analysis & build spec

**Scope.** What chat-ui must build to run the ML Intern workflow end to end, given that most of ML Intern's _tools_ are already available from the Hugging Face MCP server. The finding is that tool coverage is largely solved and **the gap is almost entirely in the agent harness, the human-in-the-loop protocol, and the MCP client's protocol surface.**

**Sources.** `/Users/peterallen/Projects/ml-intern/docs/codebase-guide/` (23 pages, read in full); chat-ui at `ml-intern-huggingchat-gaps-35f123`; the HF MCP server (live tool schemas + [hub docs](https://huggingface.co/docs/hub/en/agents-mcp) + [huggingface/hf-mcp-server](https://github.com/huggingface/hf-mcp-server)); `@modelcontextprotocol/sdk@1.26.0` (speaks MCP `2025-11-25`).

**Non-goal (stated by the requester, and endorsed here).** This is not a generic agent framework. Everything below is specified as **mode-scoped**: an "ML Intern mode" that a user turns on, which pins a tools-capable model, enables the HF MCP tool groups, swaps the system prompt, and unlocks the harness features. Features that are only meaningful inside that mode should be gated on it, not made global.

---

## 1. Verdict in one page

ML Intern is not primarily a set of tools. It is a **long-horizon supervised agent loop** with four load-bearing properties chat-ui does not have:

1. **It remembers what it did.** Every assistant `tool_calls` block and every `role:"tool"` result stays in the context across turns. chat-ui throws the entire tool trail away at the end of each generation (`prepareFiles.ts:41` maps every stored message to `{role, content}` — nothing else survives).
2. **It asks before spending money or destroying things.** `_approval_decision` is a single chokepoint in front of every tool dispatch. chat-ui has no approval concept at all, while already being able to forward the user's HF token to a server exposing `hf_jobs` and `hf_sandbox`.
3. **It runs for hours, not for ten tool rounds.** `max_iterations` defaults to 300. chat-ui caps at 10 (`runMcpFlow.ts:467`) and — worse — on hitting the cap it returns `not_applicable`, which makes `index.ts:82` **discard the whole agentic turn and re-run it from scratch with no tools**.
4. **It survives its own context window.** Compaction at ~90% of the ceiling, with a hard-stop on failure. chat-ui does no token accounting whatsoever. This becomes mandatory the moment (1) is fixed — a single `hf_jobs logs` result is tens of KB.

Around those sit the guards (doom-loop, malformed-JSON recovery, truncation, dangling-tool-call repair, retry/heal), the plan/continuation guard, the research sub-agent, cost accounting, and out-of-band notification.

On the **MCP protocol** side, chat-ui implements roughly `tools/list` + `tools/call` + progress. It is missing elicitation, resources (including HF's `skill://` resources), prompts, sampling, tasks, list-changed notifications, non-text content, `isError`, and tool annotations. Elicitation and resources are the two the requester already identified; the full list is in §5.

**What chat-ui already has that materially shortens this work:** resumable generations backed by MongoDB (`generations` + `generationEvents`, `writer.ts`, `reaper.ts`, `stream/+server.ts`), background-run notification toasts, per-message `updates[]` persistence, an artifact panel with version history and Space deployment, MCP progress notifications wired to a UI update type, a per-server MCP client pool, and HF OAuth. The pause/resume protocol that approval needs is a small extension of machinery that already exists.

---

## 2. The flow being emulated

A canonical ML Intern session, so the spec has a target to hit. Annotated with the chat-ui gap each step exposes.

| #   | Step                                                                                                           | ML Intern mechanism                                                 | chat-ui today                                            |
| --- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------- |
| 1   | User: _"fine-tune Qwen3 on my dataset"_                                                                        | `USER_INPUT` submission                                             | ✅ equivalent                                            |
| 2   | Agent writes a plan (5–10 todos), UI renders it                                                                | `plan_tool` → `plan_update` event                                   | ❌ no plan primitive (§4.6)                              |
| 3   | Agent delegates _"find the current SOTA recipe"_ to a research sub-agent; 60 tool calls, 190K tokens, isolated | `research` tool, own `messages` list                                | ❌ no sub-agent (§4.7)                                   |
| 4   | Sub-agent returns a 500–1500 word recipe table                                                                 | condensed summary only                                              | ❌                                                       |
| 5   | Agent reads real example code on GitHub                                                                        | `github_find_examples` → `github_read_file`                         | ❌ no GitHub grounding (§3)                              |
| 6   | Agent inspects the dataset schema                                                                              | `hf_inspect_dataset`                                                | ✅ via `hub_repo_details`                                |
| 7   | Agent creates a GPU sandbox → **approval card with $ estimate**                                                | `_approval_decision` + `estimate_sandbox_cost`                      | ❌ no approval, no cost (§4.3, §4.4)                     |
| 8   | Agent writes `train.py` into the sandbox, smoke-tests it                                                       | `write`/`edit`/`bash` on the sandbox                                | ✅ via `hf_sandbox_fs` / `hf_sandbox_exec` (partial, §3) |
| 9   | Agent submits an 8h GPU job → **approval card, user edits the script inline**                                  | approval payload carries the script; user may edit before approving | ❌ (§4.3)                                                |
| 10  | Job logs stream into the chat for hours                                                                        | `tool_log` events off a background thread                           | ⚠️ progress updates exist, no log stream UI (§4.11)      |
| 11  | Live training curves embed in the UI                                                                           | trackio Space seeded pre-submission                                 | ❌ (§3, §4.11)                                           |
| 12  | User closes the tab; run continues; Slack ping on completion                                                   | detached session + `notify` / auto-events                           | ⚠️ background runs exist, no out-of-band notify (§4.12)  |
| 13  | Spend crosses $5 → run pauses for "keep going?"                                                                | doubling usage thresholds                                           | ❌ (§4.4)                                                |
| 14  | Context nears the ceiling → compaction                                                                         | `ContextManager.compact()`                                          | ❌ (§4.5)                                                |
| 15  | Model is pushed to the Hub, tagged `ml-intern`, filed in a session collection                                  | `register_hub_artifact`                                             | ❌ no provenance (§4.13)                                 |
| 16  | Next turn: agent still knows the job id, sandbox id, and what the logs said                                    | full tool trail in context                                          | ❌ **the single biggest gap** (§4.2)                     |
| 17  | Trajectory uploaded for KPI/SFT                                                                                | `session_uploader.py`                                               | ❌ (§4.14)                                               |

Steps 2, 3, 7, 9, 13, 16 are what make the experience feel like ML Intern rather than "a chatbot with tools". Steps 16, 7 and 3 are the ones that change whether the workflow _works at all_ versus merely feeling different.

---

## 3. Tool coverage: ML Intern → HF MCP

The HF MCP server (`https://huggingface.co/mcp`) exposes, as of this analysis: `hf_whoami`, `hub_repo_search`, `hub_repo_details`, `hf_fs`, `hf_fs_write`, `create_repo`, `hf_jobs`, `hf_sandbox`, `hf_sandbox_exec`, `hf_sandbox_fs`, `dynamic_space`, plus `skill://` resources.

| ML Intern tool                                                                                             | HF MCP equivalent                                                                                                          | Verdict                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sandbox_create`                                                                                           | `hf_sandbox` (`create`/`status`/`terminate`/`ps`/`kill`)                                                                   | ✅ covered                                                                                                                                                                                                                                                                                                                                                                              |
| `bash` (sandbox)                                                                                           | `hf_sandbox_exec` (`exec`, `detach`, `env`, `workdir`, `stdin`, `timeout`, `tag`)                                          | ✅ covered — `detach` is _better_ than ML Intern's blocking bash                                                                                                                                                                                                                                                                                                                        |
| `read` / `write` (sandbox)                                                                                 | `hf_sandbox_fs` (`ls`/`cat`/`stat`/`write`/`rm`/`mkdir`)                                                                   | ✅ covered                                                                                                                                                                                                                                                                                                                                                                              |
| `edit` (sandbox)                                                                                           | —                                                                                                                          | ⚠️ **partial.** No fuzzy find/replace, no read-before-write guard, no post-write Python syntax + kwarg validation. ML Intern's `edit_utils.py` 4-pass matcher and `validate_python` exist because blind full-file rewrites of training scripts are a real failure mode. Mitigation is prompt-level (tell the model to `cat` then `write` whole files) plus §4.9's malformed-args guard. |
| `hf_jobs` (11 ops)                                                                                         | `hf_jobs` (13 ops, incl. all `scheduled *`)                                                                                | ✅ full parity                                                                                                                                                                                                                                                                                                                                                                          |
| `hf_repo_files` list/read/upload/delete                                                                    | `hf_fs` (ls/cat/stat/find) + `hf_fs_write` (put/rm)                                                                        | ✅ covered                                                                                                                                                                                                                                                                                                                                                                              |
| `hf_repo_git` (14 ops)                                                                                     | `hf_fs_write --branch/--create-pr/--parent-commit`, `create_repo`                                                          | ⚠️ **partial.** Branch commits, PR creation and optimistic concurrency are covered. Missing: list/merge/close PR, create/delete tag, delete branch, update repo settings. Low priority — the ML Intern flow uses `create_repo` + direct commits far more than the PR lifecycle.                                                                                                         |
| `hf_inspect_dataset`                                                                                       | `hub_repo_details` (`dataset_structure`, `dataset_preview`)                                                                | ✅ covered. ML Intern's ChatML `messages`-column analysis is prompt-level, not tool-level.                                                                                                                                                                                                                                                                                              |
| `explore_hf_docs` / `fetch_hf_docs` / `find_hf_api`                                                        | `hf_fs search hf://docs/...`                                                                                               | ✅ covered, and better (semantic, versioned via `llms.txt`)                                                                                                                                                                                                                                                                                                                             |
| `hf_papers` — trending, search, read_paper, find_all_resources                                             | `hf_fs` on `hf://papers/ARXIV_ID` (`paper.md`, `metadata.json`, related resources), `hf_fs search hf://papers`             | ⚠️ **partial**                                                                                                                                                                                                                                                                                                                                                                          |
| `hf_papers` — `citation_graph`, `snippet_search`, filtered search (`min_citations`, date range, `sort_by`) | —                                                                                                                          | ❌ **missing.** These are Semantic Scholar calls. The research doctrine's core move is _"crawl the citation graph downstream — papers that cite the anchor improved on it."_ Without a citation graph the research sub-agent degrades to keyword search.                                                                                                                                |
| `github_find_examples`, `github_read_file`, `github_list_repos`                                            | —                                                                                                                          | ❌ **missing.** `jobs_tool`'s spec makes these mandatory before any training job (_"Your internal knowledge of library APIs is outdated"_). This is the second pillar of the research doctrine after papers.                                                                                                                                                                            |
| `web_search`                                                                                               | — (HF MCP), but chat-ui already special-cases `mcp.exa.ai` and injects `EXA_API_KEY` (`hf.ts:25`, `runMcpFlow.ts:206-230`) | ✅ covered _if_ an Exa server is configured                                                                                                                                                                                                                                                                                                                                             |
| `plan_tool`                                                                                                | —                                                                                                                          | ❌ **missing by design.** Must be a chat-ui built-in: it drives a UI surface and the continuation guard, both of which are harness concerns.                                                                                                                                                                                                                                            |
| `notify`                                                                                                   | —                                                                                                                          | ❌ **missing.** Harness concern (§4.12).                                                                                                                                                                                                                                                                                                                                                |
| trackio seeding (`ensure_trackio_dashboard`)                                                               | —                                                                                                                          | ❌ **missing.** Not a tool in ML Intern either — it's a side effect of `sandbox_create`/`hf_jobs`. Needs a chat-ui-side equivalent or a bootstrap job.                                                                                                                                                                                                                                  |
| `research` sub-agent                                                                                       | —                                                                                                                          | ❌ **missing by design.** It is an agent, not a tool (§4.7).                                                                                                                                                                                                                                                                                                                            |
| Hub artifact provenance                                                                                    | —                                                                                                                          | ❌ **missing** (§4.13).                                                                                                                                                                                                                                                                                                                                                                 |
| —                                                                                                          | `dynamic_space` (image gen, TTS, OCR, background removal…)                                                                 | 🎁 **bonus** — HF MCP has capabilities ML Intern lacks.                                                                                                                                                                                                                                                                                                                                 |

**Three tool-level gaps worth closing, in priority order:** GitHub code grounding, paper citation-graph crawling, trackio dashboard seeding. See §4.8 for how to close them without building a generic tool framework.

**Operational prerequisites for the covered tools** (easy to miss, blocking in production):

- **HF MCP tool groups are per-user opt-in.** Sandbox / Jobs / Contribute-Repos are toggled at `huggingface.co/settings/mcp`. A HuggingChat user who never visits that page gets only `hf_fs` + search. chat-ui must either drive the selection via the server's `?bouquet=` / `?mix=` query parameters (the HF MCP server resolves tool selection per request from the user config API _and_ those params), or onboard the user to the settings page. **Open question — see §8.**
- **OAuth scopes.** `.env:49` currently requests `openid profile inference-api read-mcp read-billing`. Jobs and repo writes need `jobs` and `write-repos` (or `contribute-repos` for app-created repos only). Adding a scope invalidates existing sessions and forces re-login — plan the rollout.
- **`MCP_FORWARD_HF_USER_TOKEN=true`** must be on, and the forwarding is deliberately restricted to exactly `https://huggingface.co/mcp?login` (`hf.ts:6-20`). If the bouquet decision changes that URL, `isStrictHfMcpLogin` must be widened in lockstep or token forwarding silently stops.

---

## 4. Platform gaps and feature specs

Each subsection: **what's missing → why it matters → evidence → what to build → acceptance.**

### 4.1 The agent loop terminates wrong

**Missing.** A real iteration budget, and a correct terminal state when it is exhausted or when the run errors.

**Why it matters.** Two silent-failure paths, both of which destroy completed work:

- `runMcpFlow.ts:467` caps at 10 tool rounds. On exhaustion it falls out of the loop to `logger.warn("[mcp] exceeded tool-followup loops; falling back")` (`:758`) and returns `not_applicable`. `index.ts:82` reads `not_applicable` as "MCP never ran" and calls `generate()` — **re-running the entire turn from scratch, with no tools, discarding every tool result.** The user sees a plain answer and has no idea 10 rounds of work happened.
- Any thrown error inside the flow hits the same `catch` at `:759`, logs a warning, and takes the same fallback path. Transient upstream errors _are_ already retried, at the HTTP layer: the OpenAI SDK defaults to `maxRetries: 2` over 408/409/429/5xx and connection errors, with exponential backoff and `retry-after` support, and chat-ui does not override it. The bug is what happens once those retries are exhausted — the fallback above. What is genuinely missing versus ML Intern is _healing_, not retrying: a non-retryable 400 (e.g. a provider rejecting `reasoning_effort`) kills the turn, where ML Intern re-probes the effort level and retries once. Mid-stream failures are also unretried, though retrying those is unsafe anyway — tokens already streamed cannot be unsent.

An ML Intern run is 30–300 iterations. At 10, step 3 of §2 alone would exhaust the budget.

**Build.**

- Replace the literal `10` with a mode-aware budget: default (non-agentic) stays low; ML Intern mode gets `MCP_MAX_TOOL_ROUNDS` (default 200). Enforce a wall-clock ceiling too.
- Add a third result value `"exhausted"` alongside `completed | not_applicable | aborted`, and a fourth `"failed"`. `index.ts` must fall back to `generate()` **only** for `not_applicable` (genuinely never started). `exhausted` and `failed` finalize the message with what was produced plus an explanatory status update.
- Add _healing_ on top of the SDK's transport-level retries, which already cover the retryable status codes. The two cases the SDK cannot handle are a non-retryable 400 on `reasoning_effort` (re-issue once without it) and a context-overflow error (trigger compaction, §4.5, then retry) — both are permanent failures at the HTTP layer that only the caller can resolve.
- Honour `finish_reason`. Today the stream loop never reads it. `finish_reason === "length"` with accumulated tool calls means every argument string is truncated garbage — `parseArgs` (`runMcpFlow.ts:433`) silently returns `{}` and `executeToolCalls` **dispatches the tool with empty arguments**. Drop the calls, inject a system hint about smaller payloads, and retry the iteration.

**Acceptance.** A run that legitimately needs 40 tool rounds completes. Killing the upstream mid-run produces a retried, then gracefully-finalized turn — never a silent tool-free re-answer.

### 4.2 The tool trail does not survive the turn — _highest priority_

**Missing.** Persistence and replay of assistant `tool_calls` and `role:"tool"` results across turns.

**Why it matters.** `prepareMessagesWithFiles` (`prepareFiles.ts:41`) returns `{ role: message.from, content: message.content }`. Tool activity is stored in `Message.updates[]` for _rendering only_. So on turn 2 the model's entire memory of turn 1 is its own closing prose.

Concretely, with `hf_sandbox` enabled:

> **Turn 1** — model calls `hf_sandbox create` (a real Space, real money), writes `train.py`, smoke-tests it. Closes with "I've set up a sandbox and the script runs."
> **Turn 2** — user says "now run it on an A100." The model has **no sandbox id, no file path, no knowledge the sandbox exists.** It creates a second sandbox. The first leaks until HF reaps it.

The same failure applies to job ids, PR numbers, and dataset config names. This is not a fidelity nicety; it makes multi-turn agentic work incorrect and expensive.

**Build.**

1. **Persist.** Extend `Message` with an optional ordered `toolTrail`: for each round, the assistant's `tool_calls` (id, name, arguments string) and each `tool_call_id → content` result. Store alongside `updates`. Reuse the existing `updates`/`generationEvents` write path (`writer.ts`) rather than adding a second persistence channel — the data is already flowing through it, it's just not reconstructible into OpenAI wire format.
2. **Replay.** A `buildLlmMessages()` step that expands each stored assistant message into `[assistant(content, tool_calls), tool(...), tool(...), assistant(content)]`.
3. **Repair dangling calls.** Port `_patch_dangling_tool_calls` (ML Intern `manager.py:332`). Any assistant `tool_call` id without a matching following `role:"tool"` message gets a synthetic stub (`"Tool was not executed (interrupted or error)."`). **This is not optional** — chat-ui runs get aborted, reaped (`reaper.ts`), and (once §4.3 lands) paused, all of which orphan tool calls, and every OpenAI-compatible provider 400s on an orphaned `tool_calls` block. It must walk the _whole_ history, not just the last turn.
4. **Budget the trail.** Truncate individual results head-and-tail (ML Intern uses first 4800 + last 3200 chars, deliberately keeping both setup and conclusion) and spill the full text somewhere re-readable. Long job logs are the motivating case.

**Acceptance.** Turn 2 of the sandbox scenario above reuses the turn-1 sandbox. Aborting mid-tool-call and sending a new message does not 400.

### 4.3 No approval gate — _highest priority alongside 4.2_

**Missing.** Any human-in-the-loop confirmation before a tool runs.

**Why it matters.** ML Intern's `_base_needs_approval` (`agent_loop.py:243`) gates GPU sandbox creation, immediate job runs, all repo uploads/deletes, and destructive git ops; scheduled jobs **always** require a human, even under YOLO, because their cost is recurring and unbounded. `tools.py` is explicit that the router does _not_ gate — the loop is the single chokepoint.

chat-ui has nothing. `executeToolCalls` runs whatever the model emitted. With `MCP_FORWARD_HF_USER_TOKEN=true` and the sandbox/jobs tool groups on, a hallucinated `hf_jobs run` on `a100-large` for `8h`, or an `hf_fs_write rm` against a user's model repo, executes unattended against the user's account and credits. **Approval must ship in the same release as the jobs/sandbox tool groups.**

**Build — this is the largest single piece, because it requires the generation to pause and resume.**

_Policy layer_ (`src/lib/server/mcp/approvalPolicy.ts`, pure and unit-testable, mirroring `approval_policy.py`):

- Classify each parsed call → `auto | approve | blocked`.
- Seed the policy from **MCP tool annotations**, which chat-ui currently discards (`tools.ts:206` uses `annotations.title` as a description fallback and drops everything else). `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` are exactly the signal an approval policy wants. Plumb them through `CachedServerTool` and into the mapping.
- Annotations are advisory and server-controlled, so back them with an explicit rule table for known-dangerous HF tools: `hf_jobs` (any `run`/`uv`, and **always** for any `scheduled *` op regardless of auto-approve), `hf_sandbox create` on non-CPU flavors, `hf_fs_write rm`, `hf_fs_write put` outside a session-owned repo, `create_repo`.
- Reserve estimated spend _within a batch_: two individually-under-cap calls in one model response must not jointly exceed the cap (ML Intern's `reserved_auto_spend_usd`, `agent_loop.py:1548`).
- Malformed arguments short-circuit to "no approval needed" — validation will fail later anyway and there is nothing to show the user.

_Protocol layer._ chat-ui's generation is one HTTP request with an SSE stream that ends at turn completion, so pausing needs a state machine. The pieces already exist:

- New `MessageUpdateType.Approval` with subtypes `required` / `resolved`, carrying `{ requestId, calls: [{ toolCallId, name, server, arguments, annotations, estimatedCostUsd?, blockReason? }] }`.
- New `GenerationStatus` value `awaiting_approval`. The `generations` document holds the pending payload. **The reaper (`reaper.ts:33`) must exclude this status** or a paused run is marked interrupted after 90s.
- The stream terminates on `approval_required` (chat-ui's SSE already stops on terminal update types; this is a new one).
- `POST /api/v2/conversations/:id/approvals` accepts `{ requestId, decisions: [{ toolCallId, decision: "approve"|"reject", editedArguments? }] }`, revives the paused generation, executes the approved calls, injects synthetic rejection results for the rest, and continues the same logical turn on a fresh SSE stream.
- **Clear the pending state before executing** (ML Intern `agent_loop.py:2042`) so a page refresh mid-execution cannot resurrect a stale dialog.
- Abandoning a pending approval by sending new user text must inject synthetic `role:"tool"` rejection messages first (`_abandon_pending_approval`), or the history is structurally invalid — this is the same requirement as §4.2's dangling-call repair.

_UI layer._ An approval card in the message stream: tool name, server, pretty-printed arguments, cost estimate, and for `hf_jobs run` the **full script rendered and editable** plus ML Intern's `check_training_script_save_pattern` warning (script loads a model via `from_pretrained` but never sets `push_to_hub` → the output is lost when the container dies). Buttons: Approve / Approve all this turn / Reject. Rejecting must let the user type a reason that becomes the tool result — that is how the user steers.

_Settings._ Per-conversation auto-approve with a dollar cap, defaulting **off**. Never let auto-approve cover `scheduled *` jobs.

**Acceptance.** No `hf_jobs run`, `hf_sandbox create` on GPU, or `hf_fs_write` executes without an explicit click. A paused run survives a browser refresh and a 10-minute wait. Scheduled jobs prompt even with auto-approve maxed.

### 4.4 No cost estimation, spend accounting, or budget interrupt

**Missing.** All of it. Nothing in `src/lib/server` computes or tracks spend.

**Why it matters.** Approval cards without dollar figures are approval theatre. And a run that quietly accumulates $40 across many individually-cheap auto-approved calls is exactly the failure ML Intern's doubling thresholds ($5 → $10 → $20 → …) exist to catch.

**Build.**

- **Price catalog.** Fetch `/api/jobs/hardware` with a ~6h TTL; merge live prices _over_ a static fallback table so an outage degrades instead of failing. Add Space hourly prices for sandbox flavors.
- **Estimator.** `estimateToolCost(server, tool, args)` → `{ estimatedUsd: number | null, billable, label }`. Adopt ML Intern's load-bearing sentinel: **`null` means "might be billable, could not price it" and forces a human decision.** Never treat unpriceable as free. Parse HF timeouts correctly — a bare number is _seconds_ (`1800` = 0.5h, not 1800h); an unparseable timeout yields `null`, not a default.
- **Sandbox estimates are deliberately pessimistic** (ML Intern reserves 1.0h regardless of real duration). Keep that; over-estimating is the safe direction for a pre-approval guard.
- **Accounting.** Per-conversation accumulator over accepted estimates, plus real inference cost. chat-ui already sets `X-HF-Bill-To` and holds `read-billing` scope, so the HF billing API is reachable for authoritative figures; use local telemetry as the fast path and billing as the source of truth at checkpoints, and tell the UI which one a number came from (ML Intern's `billing_source`).
- **Threshold interrupt.** At each doubling checkpoint, pause the run with a "you've spent $X — continue?" prompt. Implement it as a **synthetic approval** riding the exact §4.3 protocol (ML Intern's `usage_threshold_pending_to_tool` trick) so there is one pause mechanism, not two.

**Acceptance.** An `hf_jobs run` approval card shows a plausible dollar figure. A conversation crossing $5 pauses once, and the next pause is at $10.

### 4.5 No context management or compaction

**Missing.** Token counting, a compaction trigger, and a summarization pass.

**Why it matters.** chat-ui sends the full history every turn with no ceiling awareness. Today that mostly works because assistant messages are prose. The moment §4.2 lands, one `hf_sandbox_exec` or `hf_jobs logs` result can add 50K+ tokens. ML Intern hit an infinite compaction loop from exactly one ~80K-token tool output stuck in the preserved tail, and added a hard 50K-per-message truncation to defuse it.

**Build.**

- Track a running token estimate. Prefer the provider's reported usage when available; a 4-chars-per-token fallback is what ML Intern uses when the tokenizer raises, and is adequate.
- Add `contextWindow` to the model config (`models.ts`) with a conservative default. ML Intern's fallback is 200K, and it notes this under-triggers compaction for smaller unknown models — prefer a _low_ default here.
- Compact at ~90% of the ceiling: preserve `[system, first user message, LLM summary of the middle, last N messages walked back to a user boundary]`.
- Truncate any single preserved message over ~50K tokens to a placeholder _before_ summarizing.
- The recent-tail boundary must land strictly after the first user message, or that message appears twice and providers 400 on two consecutive user turns.
- **Compaction failure is a hard stop, not a retry.** ML Intern documents the alternative: a caller that loops on a failing compaction burned ~$3/attempt until the pod was killed, and because the session never ended cleanly the spend was invisible. Emit a terminal status and stop the run.
- Two prompts, opposite goals: a terse decision-focused one for compaction, and a first-person handoff note preserving the complete tool-call trail, file paths, and next steps for session restore.

**Acceptance.** A 60-round agentic run with large tool outputs completes without a context-length error and without unbounded cost.

### 4.6 No plan primitive or continuation guard

**Missing.** A `plan_tool` equivalent and the guard that reads it.

**Why it matters.** Two separate jobs. The plan is the user's progress bar for a run that may last hours — without it, a long agentic turn is an opaque wall of tool calls. The **continuation guard** is what stops the model handing control back mid-task: after a text-only response, if the plan still has `pending`/`in_progress` items, ML Intern injects a `[SYSTEM: CONTINUATION GUARD]` user message listing them and forces another turn (capped at 2 retries so a genuinely stuck turn still returns). In headless/unattended mode a text-only turn permanently ends the loop with nobody watching to re-prompt.

**Build.**

- A chat-ui **built-in** tool `plan` (not MCP) taking the entire todo list every call — full replacement, never a diff. Validate `{id, content, status: pending|in_progress|completed}`.
- Store on the conversation (the `deployedSpaces` field on `Conversation` is the precedent for conversation-scoped agent state) and emit a `MessageUpdateType.Plan` update.
- UI: a pinned, collapsible checklist in the message stream that updates live.
- Continuation guard in the loop, capped at 2 retries.
- **Requires a built-in-tool path.** chat-ui's tool registry is MCP-only (`getOpenAiToolsForMcp`). Adding `plan` means a small merge step where built-ins are prepended to the MCP tool array and `executeToolCalls` dispatches locally when a name resolves to a built-in. Keep it deliberately minimal — this is not a plugin system; it's the seam that §4.7 and §4.8 also need.

### 4.7 No sub-agent / context isolation

**Missing.** Any way to run a nested LLM loop with its own context window.

**Why it matters.** This is the mechanism behind the research-first doctrine. `research` fires up to 60 tool calls and ~190K tokens against a whitelist of 12 read-only tools and returns a 500–1500 word recipe table. Without isolation, one citation-graph crawl consumes the main context and compaction (§4.5) starts throwing away the very findings it produced.

**Build.**

- A built-in `research` tool that runs its own completion loop against the same MCP client pool, with a **hardcoded read-only tool whitelist** — `hf_fs`, `hub_repo_search`, `hub_repo_details`, plus the GitHub and papers tools from §4.8. Re-check the whitelist at dispatch, not just at spec-filter time.
- Budget: max iterations, max tokens, with a soft "start wrapping up" injection at 75% and a forced tool-less summary call at the hard ceiling.
- Stream progress as `tool_log`-style updates so the UI does not look frozen for minutes. chat-ui's `MessageToolUpdateType.Progress` is the right carrier.
- **Strip provider-specific fields on echo.** ML Intern drops `provider_specific_fields` and `reasoning_content` when appending the sub-agent's assistant message, because the HF router's OpenAI schema rejects them on the next request. chat-ui will hit this identically.
- Run the same doom-loop guard (§4.9) inside the sub-agent.
- Own system prompt encoding the six-step crawl: anchor papers → citation graph _downstream_ → methodology sections 3/4/5 → attribute every result to a full recipe (_"dataset X + method Y + lr Z → score W"_, never _"they used SFT"_) → validate datasets on the Hub → find code.

### 4.8 Three missing tools

Build as **built-ins on the §4.6 seam**, not as a new MCP server, unless one already exists that you trust:

- **GitHub grounding** — `github_find_examples` (fetch the recursive tree once, two-stage fuzzy filter over an ordered example-directory priority list, keyword pass), `github_read_file` (contents API, base64 → raw fallback for >1MB files, `.ipynb` → markdown, 300-line cap with a paging hint), `github_list_repos`. Needs a server-side `GITHUB_TOKEN`. **Alternative: adopt an existing GitHub MCP server** — cheaper if one covers example discovery well. Evaluate before building.
- **Paper citation graph** — `citation_graph` (references + citations, concurrent, partial-success tolerant) and `snippet_search` over full text, via Semantic Scholar. Note the operational trap: without an `S2_API_KEY` there is no client-side throttle at all, and each resulting 429 costs a 60-second sleep. Get a key.
- **trackio seeding** — port `ensure_trackio_dashboard`: `create_repo(space_sdk="gradio", exist_ok=True)`, write `README.md` / `requirements.txt` / `app.py` (`import trackio; trackio.show()`) only when not already seeded (idempotency keyed on the literal `"trackio.show"` in `app.py`), create a private bucket, mount at `/data`, set `TRACKIO_DIR=/data/trackio` and `TRACKIO_BUCKET_ID`. Both the job and the dashboard **must** point at the same bucket or the embedded iframe shows "No projects". Deliberately omit `hf_oauth` from the README so the iframe renders without a login click.

### 4.9 No loop guards

**Missing.** Doom-loop detection, malformed-argument recovery, truncation handling.

**Why it matters.** A 200-iteration budget without repetition detection is a credit incinerator. chat-ui has none of the three.

**Build.**

- **Doom loop.** Hash recent tool-call signatures as `(name, normalized-args, result)` over the last ~30 messages. Fire on 3+ identical consecutive, or a 2–5 step cycle repeated twice. Inject a `[SYSTEM: REPETITION GUARD]` user message. **Folding the _result_ into the signature is the load-bearing detail** — it is what lets legitimate polling (same args, changing output: `hf_jobs logs`, `hf_sandbox status`) escape the guard. Normalize args by re-serializing JSON with sorted keys so key-order variants collapse.
- **Malformed arguments.** `parseArgs` (`runMcpFlow.ts:433`) returns `{}` on a JSON parse failure and the tool is dispatched anyway. Instead: return an immediate error result to the model naming the failure, and on 2+ consecutive malformed results for the same tool, inject a recovery prompt steering toward smaller payloads.
- **Truncation.** Covered in §4.1.
- **Corrective prompts go in as `role:"user"` with a `[SYSTEM: …]` prefix**, not as system-prompt mutations — the model treats them as external directives rather than its own prior output.

### 4.10 The system prompt works against agentic use

**Missing.** A mode-scoped doctrine prompt.

**Why it matters.** `toolPrompt.ts` currently says: _"IMPORTANT: Do NOT call a tool unless the user's request requires capabilities you lack… For tasks like writing code, creative writing, math, or building apps, respond directly without tools. When in doubt, do not use a tool."_ That is a reasonable default for a general chat assistant and the **exact inverse** of ML Intern's doctrine, whose opening line is _"Your knowledge of HF libraries is outdated. Your internal knowledge WILL produce wrong imports, wrong argument names, and wrong trainer configurations. Before writing any ML implementation code, start from the literature."_

**Build.** A mode-scoped prompt following the `injectArtifactsPrompt` precedent (`artifacts.ts:57` — capability-conditional prompt injection is already an established pattern here). Contents, ported from `system_prompt_v3.yaml` and the HF Jobs tool description:

- Research-first mandate + the `research` sub-agent delegation rule.
- The "mistakes you WILL make" list: hallucinated imports, wrong trainer args, models lost to a missing `push_to_hub=True`, scope-changing OOM workarounds.
- Hard rules: GPU preflight in a sandbox before any real job; `push_to_hub=True` + `hub_model_id` or the model is lost; **never silently substitute** a dataset or model — tell the user; **never downgrade the task to dodge an error** (SFT→LoRA, shrinking `max_length` on OOM) — fix the cause.
- Job sizing guidance, and the explicit note that `a10g-small` → `a10g-large` shares the same 24GB GPU and will _not_ fix a CUDA OOM.
- **Always pass an explicit multi-hour `timeout`** — the HF Jobs default is 30 minutes and silently kills training mid-run.

Keep the generic anti-tool paragraph for non-agentic conversations; select between prompts on the mode flag.

### 4.11 No live compute surfaces

**Missing.** Log streaming UI, job status cards, embedded dashboards, remote cancellation.

**Build.**

- **Log streaming.** `hf_sandbox_exec` supports `detach`; `hf_jobs logs` streams. Render an incrementally-updating, scroll-anchored log panel inside the tool card. `MessageToolUpdateType.Progress` (already wired end to end from MCP progress notifications) is the transport for status; logs need a new update subtype carrying appended text. Filter installer noise (ML Intern collapses verbose `uv` install blocks and strips ANSI) — otherwise the panel is unreadable.
- **Job cards.** Status, flavor, elapsed, cost-so-far, a link to the Hub job page, and a **Cancel** button.
- **trackio embed.** An iframe panel for the seeded dashboard. The artifact panel is the obvious host — it already does side-panel rendering with sandboxed iframes.
- **Cancel must propagate.** On abort, chat-ui currently just stops reading the stream. ML Intern's `_cleanup_on_cancel` kills sandbox processes and cancels running HF jobs. Track live job ids and sandbox ids on the conversation, and on abort issue `hf_jobs cancel` / `hf_sandbox kill`. **Without this, a user pressing Stop leaves an 8-hour A100 job billing.**

### 4.12 No out-of-band notification

**Missing.** Any way to reach a user who closed the tab.

**Why it matters.** _"Kick off a job, walk away, come back to a finished task"_ is the entire point. chat-ui has in-app toasts (`notifications.svelte.ts`) which only fire if a tab is open.

**Build.** ML Intern's model is two independent per-destination gates — `allow_auto_events` (the framework may fire here) and `allow_agent_tool` (the LLM may target this via `notify`). Keep that separation; ML Intern's own docs call the two flags the most likely operator misconfiguration, precisely because they're independent.

For a web app the natural channels are Web Push and email, not Slack. Auto-fire on: **approval required** (the highest-value one — an unattended run blocked on a click is dead until someone notices), run errored, run complete. Optionally expose a `notify` built-in so the model can ping at a moment of its choosing.

### 4.13 No artifact provenance

**Missing.** Tagging and collecting what the agent produces.

**Build (light).** After any `create_repo` or `hf_fs_write put` that chat-ui approved, augment the repo card with a `huggingchat` tag and a provenance section (idempotent via an HTML-comment sentinel), and add the repo to a per-conversation private Hub collection. Everything best-effort: never fail a tool call because provenance failed.

**Explicitly skip** ML Intern's `sitecustomize.py` injection (monkey-patching `HfApi` inside job containers so repos created _by the training script_ self-register). It is ~350 lines of duplicated logic maintained by hand against the Python implementation above it, and it is the wrong cost/benefit for a first version.

### 4.14 No trajectory export

**Missing.** Any structured export of a run.

**Build (low priority, do last).** Export `{messages, toolTrail, events, cost, model, tags}` to a Hub dataset, opt-in, reusing the existing `shareConversationsWithModelAuthors` consent surface. ML Intern derives `namespace:value` tags from a pure function over the event stream (`tool:`, `outcome:`, `hf_job:`, `gpu:`, `cost:`, `task:` …) so downstream consumers can slice without re-reading trajectories — worth copying if this gets built.

---

## 5. MCP protocol surface gaps

chat-ui speaks `tools/list`, `tools/call`, and progress notifications. The SDK it already depends on (`@modelcontextprotocol/sdk@1.26.0`) implements MCP `2025-11-25` in full, so most of this is wiring, not new protocol work.

The single root cause for the interactive features: **chat-ui never declares client capabilities.** Both client constructors — `tools.ts:155` and `clientPool.ts:76` — are `new Client({ name: "chat-ui-mcp", version: "0.1.0" })` with no second argument. A server reads the empty capability set at `initialize` and correctly concludes it may not elicit, may not sample, and may not ask for roots.

| Feature                                                                        | Status                      | Why it matters for this workflow                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Priority             |
| ------------------------------------------------------------------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| **Elicitation** (`elicitation/create`)                                         | ❌ not declared, no handler | A server asks the _user_ a question mid-tool-call, with a JSON-schema form (and, in `2025-11-25`, a URL mode). Exactly right for "which namespace should I bill this job to?", "this dataset has 3 configs — which?", "confirm this job config". Today an HF MCP server that wants to ask must instead fail the call and hope the model retries. Note this is **orthogonal to §4.3**: elicitation is _server_-initiated; approval is _client_-initiated policy. Both are needed, and they should share one UI pause surface. | **P0**               |
| **Resources** (`resources/list`, `resources/read`, `resources/templates/list`) | ❌                          | The HF MCP server exposes **skills** as `skill://` resources with `resources/directory/read` for scoped navigation, advertising the `io.modelcontextprotocol/skills` extension. Skills are how HF ships procedural knowledge (the exact "here is how you actually fine-tune with TRL" content the research doctrine wants) and chat-ui cannot read any of it. Also the natural mechanism for `@`-mentioning a dataset or repo into context.                                                                                  | **P0**               |
| **`isError` on tool results**                                                  | ❌ **never read**           | `callMcpTool` (`httpClient.ts:130-144`) builds `text` from content blocks and returns; it never inspects `response.isError`. `toolInvocation.ts:280` then unconditionally reports `ToolResultStatus.Success`. **A tool that returns a protocol-level error is presented to both the user and the model as a success.** One-line-ish fix, real correctness bug.                                                                                                                                                               | **P0**               |
| **Non-text content**                                                           | ⚠️ partial                  | Only `type:"text"` blocks are joined into the string sent to the model. `ImageContent`, `AudioContent`, `ResourceLink` and `EmbeddedResource` are forwarded raw to the UI but **stripped from the model's view**. So `dynamic_space` image generation, or any tool returning a chart, gives the model nothing to reason about. Feed images to multimodal models as image parts; render `ResourceLink`/`EmbeddedResource` and summarize them textually for the model.                                                         | **P1**               |
| **`structuredContent`**                                                        | ⚠️ captured, unused         | Plumbed to the UI (`httpClient.ts:140`) but never given to the model, and `outputSchema` is ignored entirely. For `hf_jobs inspect` / `hf_sandbox ps`, structured output is more reliable to reason over than prose.                                                                                                                                                                                                                                                                                                         | **P1**               |
| **Tool annotations**                                                           | ⚠️ discarded                | `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` dropped at `tools.ts:206`. These are the natural input to the approval policy (§4.3) and to a "this tool is safe" UI affordance.                                                                                                                                                                                                                                                                                                                        | **P1** (blocks §4.3) |
| **Tasks** (`2025-11-25`)                                                       | ❌                          | Long-running tool calls return a task handle and are polled rather than held open. This is _precisely_ the `hf_jobs run` / `hf_sandbox_exec --detach` shape. Today chat-ui holds a call open for up to `MCP_TOOL_TIMEOUT_MS` (default 120s, progress-resettable, hard ceiling 10×). An 8-hour training job cannot be modelled as a synchronous tool call. Adopt if/when the HF server supports it; until then §4.11's job-card polling is the workaround.                                                                    | **P1**               |
| **`notifications/tools/list_changed`**                                         | ❌                          | Tool lists are cached for 60s (`tools.ts:37`) with no subscription. A user toggling tool groups at `settings/mcp`, or a `dynamic_space` discovery that adds tools, is invisible for up to a minute.                                                                                                                                                                                                                                                                                                                          | **P2**               |
| **Prompts** (`prompts/list`, `prompts/get`)                                    | ❌                          | Server-provided prompt templates as slash-commands. Nice-to-have; a natural way to ship "start a fine-tuning run" as a one-click entry point.                                                                                                                                                                                                                                                                                                                                                                                | **P2**               |
| **Sampling** (`sampling/createMessage`)                                        | ❌                          | Lets a server ask _chat-ui's_ LLM to do work, billed to the user's account. Powerful and dangerous — it hands an external server a budget. If adopted, gate behind explicit per-server consent and a token cap.                                                                                                                                                                                                                                                                                                              | **P3**               |
| **Roots** (`roots/list`)                                                       | ❌                          | Filesystem-oriented; little value in a hosted chat.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | **P3**               |
| **Logging** (`notifications/message`)                                          | ❌                          | Server-side log levels; useful for debugging third-party servers.                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **P3**               |
| **OAuth 2.1 authorization flow**                                               | ❌                          | chat-ui does static header auth only. `authRequired` is surfaced as a health-check status flag (`health/+server.ts:245`) but there is no authorization-code flow with dynamic client registration. Fine for HF (token forwarding) and Exa (URL key); blocking for any third-party server a user wants to add.                                                                                                                                                                                                                | **P2**               |

**Elicitation — build notes.** Register an `elicitation/create` handler on the pooled client. The request arrives _while a `tools/call` is in flight_, so the handler must reach the user and return their response before the call completes. This forces the same pause/resume machinery as §4.3, which is the argument for building §4.3 first and treating elicitation as a second producer of the same pause event. Render the JSON-schema form generically (string / number / boolean / enum, with `description` as the label). Honour the three-outcome response (`accept` / `decline` / `cancel`) — declining is not the same as cancelling. Time-box the wait and return `cancel` on expiry so a pooled client is not held open forever.

**Resources — build notes.** Add `resources/list` + `resources/read` to the client. Two consumers: (a) a picker so users can attach a resource to a message; (b) an agent-facing built-in `read_resource` tool so the model can pull a `skill://` document mid-run. Cache like tool listings (per server+headers, short TTL). Support `resources/directory/read` for the HF skills tree specifically — a flat `resources/list` over a large skills directory is not usable.

---

## 6. Sequencing

Phases are ordered by dependency and by risk-of-shipping-something-unsafe. **Phase 1 is not optional if the jobs/sandbox tool groups are enabled** — everything in it is a correctness or safety fix.

**Phase 1 — make agentic runs correct and safe.** §4.2 tool trail + dangling-call repair · §4.3 approval gate (policy + pause/resume + card) · §4.1 loop budget, terminal states, healing · `isError` (§5) · tool annotations (§5) · §4.4 cost estimation _for the approval card only_.
_Rationale: (4.2) makes multi-turn work correct, (4.3) makes it safe, (4.1) stops it silently discarding work. Annotations and `isError` are small and feed the approval policy._

**Phase 2 — make long runs survivable.** §4.5 compaction · §4.9 loop guards · §4.4 spend accounting + threshold interrupt (reusing the Phase 1 pause) · §4.11 cancel propagation.
_Rationale: with Phase 1's persisted trail, context growth and repetition become the binding constraints. Cancel propagation is grouped here because it is a money leak._

**Phase 3 — make it feel like ML Intern.** §4.10 doctrine prompt · §4.6 plan + continuation guard (introduces the built-in-tool seam) · §4.7 research sub-agent · §5 elicitation + resources.
_Rationale: this is the phase where the product identity appears. Elicitation lands here because it reuses Phase 1's pause surface._

**Phase 4 — the ML-specific surfaces.** §4.8 GitHub + citation graph + trackio seeding · §4.11 log streaming, job cards, dashboard embed · §4.12 out-of-band notification.

**Phase 5 — the long tail.** §4.13 provenance · §4.14 trajectory export · §5 P2/P3 protocol items (tasks, prompts, list-changed, OAuth).

---

## 7. Explicit non-goals

- **A generic agent framework or plugin system.** The built-in-tool seam (§4.6) exists to host three or four specific tools, not arbitrary extensions.
- **Replicating ML Intern's CLI**, its terminal UX, or its dual-driver architecture. chat-ui is the web front-end; there is no second driver.
- **Local-filesystem tools.** ML Intern's `local_mode` (`bash`/`read`/`write`/`edit` on the user's machine) has no meaning in a hosted web app. Sandbox-only.
- **The `sitecustomize.py` in-container provenance hook** (§4.13).
- **An effort probe / cascade.** ML Intern probes because HF Router's accepted effort set is small and shifting. chat-ui should instead just _handle the 400_ (§4.1's healing) — far less machinery for the same protection.
- **Replacing the HF MCP server** with built-in HF tools. Where HF MCP covers a capability, use it.

---

## 8. Open questions

1. **Tool-group selection.** Sandbox / Jobs / Contribute-Repos are per-user opt-in at `huggingface.co/settings/mcp`. Can chat-ui request them per-request via `?bouquet=` / `?mix=` on the MCP URL, or must users be onboarded to that settings page? This decides whether ML Intern mode is one click or a multi-step setup. **Note:** any URL change breaks `isStrictHfMcpLogin` (`hf.ts:6-20`) and silently stops HF token forwarding — the two must change together. _Needs a conversation with the hf-mcp-server team._
2. **OAuth scope rollout.** Adding `jobs` and `write-repos` invalidates every existing session cookie. Staged rollout, or request-on-demand when a user first enables ML Intern mode?
3. **Who pays for the sub-agent?** The research sub-agent (§4.7) can burn ~190K tokens on the user's inference credits in a single tool call, with no approval prompt in the current design. Does it need its own budget gate, or does the §4.4 threshold interrupt cover it?
4. **Where does ML Intern mode live in the product?** A model-level flag (`supportsArtifacts` is the precedent), a per-conversation toggle, or a dedicated assistant/persona? This determines whether the doctrine prompt, tool selection, and loop budget are model config, conversation state, or user settings.
5. **Sandbox lifecycle ownership.** ML Intern preloads a free CPU sandbox per session and tears it down at session end, plus runs an admin sweeper for orphans (it observed 2,310 leaked Spaces on a single day). If chat-ui enables `hf_sandbox`, who deletes them, and when? A conversation has no clean "end". This needs an answer _before_ the sandbox tool group is enabled, not after.
6. **GitHub tools: build or adopt?** Evaluate existing GitHub MCP servers for example-discovery quality before writing `github_find_examples`.
7. **Is `edit` worth porting?** ML Intern's fuzzy 4-pass matcher plus Python kwarg validation exists because blind rewrites of training scripts are a real failure mode. `hf_sandbox_fs write` is whole-file only. Start prompt-level, measure, port if it hurts.
