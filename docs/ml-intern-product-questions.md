# ML Intern in HuggingChat — open product questions

Companion to [ml-intern-parity-spec.md](./ml-intern-parity-spec.md). That doc says _what_ to build; this one lists the decisions that are product calls, not engineering calls.

## How to use this

Every question is tagged with what it blocks:

- 🔴 **Blocks Phase 1** — engineering cannot start the safety-critical work without an answer.
- 🟠 **Blocks a specific feature** — that feature can't start, others can.
- 🟢 **Needed before launch** — build can proceed on a default; decide before users see it.

**Appendix A** lists the work that needs no product input at all, so that can start in parallel today.

Where I have a recommendation I've said so — treat them as a starting position to argue with, not a conclusion.

---

## §0. The framing question

Everything else is downstream of this one.

### Q0.1 🔴 What is the smallest version of this that is worth shipping?

The spec describes full parity. There are at least three coherent products inside it, and they have very different cost, risk, and build size:

|                            | Scope                                                                                   | Needs approval gates? | Needs cost UX? | Needs sandbox lifecycle? | Rough size |
| -------------------------- | --------------------------------------------------------------------------------------- | --------------------- | -------------- | ------------------------ | ---------- |
| **A. Research assistant**  | Reads papers, docs, Hub, GitHub. Writes a training script. **Never executes anything.** | No (all read-only)    | No             | No                       | Small      |
| **B. Supervised operator** | A + runs sandboxes and jobs, but every billable action is confirmed                     | Yes                   | Yes            | Yes                      | Large      |
| **C. Autonomous intern**   | B + auto-approve with budget caps + walk-away runs + out-of-band notification           | Yes                   | Yes            | Yes                      | Largest    |

A is deliverable much sooner and is genuinely useful on its own — it's ~60% of the perceived "ML Intern" experience (research doctrine, plan, sub-agent, code grounding) with almost none of the risk surface. It also gives us real usage data on whether people want B.

**Recommendation: ship A first, and treat it as a real product rather than a stepping stone.** But answer this deliberately — if the team's goal is B/C, then approval gates and cost UX are Phase 1 and the sequencing in the spec holds.

**Corollary if we pick A:** we must decide whether A _hides_ the compute tools or _shows them disabled with an explanation_. Hiding is cleaner; showing sets up the upgrade.

### Q0.2 🟠 Who is this for?

Free users can't run HF Jobs at all — Jobs are credit-gated per namespace, independent of Pro. So option B/C is structurally a paying-user feature, while option A works for everyone.

Does that mean: (a) ML Intern mode is Pro-only, (b) it's available to all but compute tools are gated behind credits, or (c) free users get option A and Pro users get B?

This decides how much "you need credits" UX we build and whether the mode is discoverable to the majority of users who can't fully use it.

### Q0.3 🟢 Is this HuggingChat-only or does it ship to self-hosters?

Nearly all of it is HF-specific (Jobs, Spaces sandboxes, Hub writes, HF billing). The `publicConfig.isHuggingChat` pattern exists for this. But the _harness_ (approval, plan, compaction, sub-agent) is generic and self-hosters with their own MCP servers would benefit.

Cheapest answer: harness generic, ML-Intern-specific surfaces gated. Worth confirming so we don't build config surface we don't need.

---

## §1. Mode and entry

### Q1.1 🔴 What _is_ the mode, structurally?

Four options, each with different implications:

1. **A model.** ML Intern is an entry in the model picker. Uses the existing `supportsArtifacts`-style config flags. Familiar, discoverable, but conflates "which model" with "which behaviour", and the mode needs to _pin_ a tools-capable model anyway.
2. **A per-conversation toggle.** Like the existing tools/MCP selector. Composable with any model. Risk: users toggle it on a model that can't do tools.
3. **An assistant/persona.** Reuses existing assistant infrastructure (custom prompt + tools). Least new code. Risk: assistants are a somewhat separate product area with its own discovery.
4. **A separate entry point** (`/chat/ml-intern` or similar). Strongest identity, clearest expectation-setting, most product surface to build.

This determines whether the doctrine prompt, tool selection, loop budget, and approval defaults live in model config, conversation state, or user settings — which is a real fork in the data model.

**Recommendation: (2) a per-conversation mode that also pins the model,** so the model choice is a consequence of the mode rather than a competing axis. But (3) is worth costing — it may be nearly free.

### Q1.2 🟠 Can you switch modes mid-conversation?

If a user turns ML Intern mode on at message 10, what happens? The doctrine prompt changes, the tool set changes, the loop budget changes — but the history was produced under different rules.

Options: allow it freely; allow on→off but not off→on; force a new conversation; offer "continue in a new ML Intern conversation" with context carried over.

Same question in reverse: if a user turns it _off_ mid-run, do we cancel in-flight jobs?

### Q1.3 🟢 What is it called, and how do we set expectations?

"ML Intern" is an internal HF product name that HuggingChat users won't recognise. Whatever we call it, the entry point needs to communicate: this runs for a long time, it spends your credits, it will ask you before doing so, and it works on your Hugging Face account.

Is there an onboarding moment (first-run explainer, sample tasks), or does it just appear?

### Q1.4 🟢 What are the sample/starter prompts?

The Omni prompt-example machinery already exists (`hidePromptExamples` per model). ML Intern mode needs its own set — and they double as the main way users understand what it's for. "Fine-tune Qwen3 on my dataset" is a very different opening move from the general chat examples.

---

## §2. Approval gates

The largest new UX surface. These questions block the Phase 1 build directly.

### Q2.1 🔴 What is the default posture?

Three defaults, each defensible:

- **Ask every time** for anything billable or destructive. Safest, most annoying, and the one that makes a walk-away run impossible without §5.
- **Auto-approve under a cap** the user sets when enabling the mode (e.g. "$10 for this conversation"). ml-intern's model. Enables walk-away, requires cost UX (§3) to ship simultaneously.
- **Ask once per tool per conversation** — approve `hf_jobs run` once, subsequent runs in that conversation auto-approve. Middle ground, but the second job may cost 40× the first.

**Recommendation: ask-every-time as the shipped default, with an opt-in cap.** But note this makes option C in Q0.1 impossible until the cap exists, so the answer here and in Q0.1 must agree.

### Q2.2 🔴 What granularity does a decision cover?

A model response can contain several tool calls at once. Do we show one card per call, or one card per batch with per-item toggles? ml-intern prompts per item but offers "approve everything remaining."

Related: do we offer **"don't ask again for this tool"**, and if so, is that scoped to the conversation or to the user account? A user-level "never ask me about `hf_fs_write` again" is a standing grant of write access to their Hub — that needs to be a deliberate decision, not a checkbox on a card.

### Q2.3 🔴 Are read-only tools ever gated?

We can read MCP `readOnlyHint`/`destructiveHint` annotations, but they're advisory and server-controlled. Do we (a) trust annotations, (b) maintain our own allow/deny list for known HF tools, or (c) both, with our list winning?

**Recommendation: (c).** Trusting a third-party server's self-declared "I am read-only" is not a security boundary. But this means we carry a maintained list — product needs to accept that cost.

### Q2.4 🟠 How much can the user edit before approving?

ml-intern lets the user **edit the training script inline** in the approval prompt before it runs. That's high-value (the model gets hyperparameters wrong, the human fixes them without a round-trip) and a meaningful build.

Options: read-only display; edit the script only; edit any argument as JSON.

Also: when we show a job submission, what exactly do we show? Full script, flavor, timeout, estimated cost, target repo — that's a lot of card. What's the collapsed vs. expanded state?

### Q2.5 🟠 What does rejection do?

Binary reject, or reject-with-a-reason that becomes the tool result the model sees? The latter is how a user steers ("no, use bf16 and a smaller batch") and is significantly more useful — but it's a text input inside a card, which changes the component.

**Recommendation: reject-with-optional-reason.** It's the difference between a gate and a conversation.

### Q2.6 🔴 What happens if nobody answers?

A paused run holds server state. Does it expire? After how long? What does the user see when they return to an expired one — can they resume, or must they re-ask?

This is a real constraint on the engineering: the generation reaper currently kills anything with a stale heartbeat after 90s, so "paused" needs an explicit lifetime policy, not an accident.

### Q2.7 🟢 Is an approval card usable on a phone?

A meaningful share of HuggingChat traffic is mobile. An approval card containing a 200-line training script, a cost estimate, and an edit affordance is a hard mobile design problem. Do we ship a reduced mobile card (approve/reject only, "open on desktop to edit")?

### Q2.8 🟢 How do we show _which server_ a tool came from?

Once third-party MCP servers are in play, "Approve `write_file`?" is meaningless without knowing who's asking. Do tool cards carry a server identity chip? Is there a trust indicator distinguishing HF's own server from a user-added one?

---

## §3. Cost, credits, and budgets

### Q3.1 🔴 Do we show dollars?

HF bills real money for Jobs and Spaces. Options: raw USD; HF credits; an abstraction ("~2 hours of A100 time"); or nothing pre-flight and only actuals afterwards.

Dollars are honest and make the approval card meaningful. They may also be alarming in a chat UI, and they're the number most likely to be _wrong_ (pre-flight estimates are deliberately pessimistic — ml-intern reserves a full hour for any sandbox regardless of real use).

**Recommendation: show an explicitly-labelled estimate range on approval cards, and actuals afterwards.** Do not show a single confident number for something we're systematically over-estimating.

### Q3.2 🔴 Do we surface inference cost, or only compute?

ml-intern tracks both — and found that before it instrumented every LLM call site, ~67% of spend was invisible. A 200-iteration agentic run's own token spend is not trivial.

But HuggingChat has never shown users a per-message inference cost, and starting now is a significant product change with implications well beyond this feature.

Options: compute only (jobs/sandboxes); compute + inference but only inside ML Intern mode; both everywhere.

### Q3.3 🟠 Where does spend live in the UI?

Per-approval-card only? A running total chip in the conversation header? A per-conversation summary at the end of a run? A cross-conversation spend page?

The header chip is the one that makes a long run feel controlled rather than frightening — but it's persistent chrome, which is expensive real estate.

### Q3.4 🟠 Threshold interrupts: what and how often?

ml-intern pauses at doubling checkpoints — $5, $10, $20, $40. Questions: is the first threshold right for HuggingChat? Is it user-configurable? Is doubling the right curve, or should it be a flat interval? Does the interrupt use the same card as an approval, or is it visually distinct?

**Recommendation: reuse the approval card exactly** — one pause mechanism the user learns once. ml-intern does the same thing by modelling the threshold prompt as a synthetic tool approval.

### Q3.5 🟠 Can a user set a budget up front?

"Run this, spend up to $20" is a much better walk-away story than approving 15 individual cards. It's also the thing that makes auto-approve safe.

Where is it set — when enabling the mode, per conversation, in settings? Does it reset? What happens when it's exhausted mid-run — pause, or hard stop?

### Q3.6 🟢 What happens when credits run out mid-run?

The HF API returns 402 with credit/billing language. ml-intern turns it into a plan-aware CTA (Pro users → billing page, free users → subscribe page). What's our version, and does the run stay resumable after they top up?

---

## §4. Plan mode

### Q4.1 🟠 Is the plan a separate feature or an implicit part of agentic mode?

The plan has value outside ML Intern mode — any multi-step task benefits. But it also implies the continuation guard (the agent won't hand control back while items are pending), which is a behaviour change users need to understand.

Options: always on in ML Intern mode, invisible elsewhere; a separate toggle; on for any conversation using tools.

### Q4.2 🟠 Where does it render?

Three candidate locations, with a conflict:

1. **Inline in the message stream**, at the point the agent wrote it. Chronologically honest, but scrolls away during a long run — exactly when you need it.
2. **Pinned above the composer or in the header.** Always visible. Costs persistent chrome.
3. **In the side panel.** Roomy — but the side panel is the artifact panel, and ML Intern mode will produce artifacts (training scripts, results). Do they share, tab, or stack?

**Recommendation: inline for history + a collapsed pinned summary ("3 of 7 done") that expands.** But the side-panel conflict needs an explicit answer since both features want that space.

### Q4.3 🟠 Can the user edit the plan?

Big fork. Read-only plan = a progress indicator. Editable plan = a steering mechanism, and arguably the best one in the whole feature: reorder, delete a step, add "also evaluate on X", tick something off manually.

If editable, the edits have to re-enter the model's context, and we need to decide whether an edit interrupts the current turn or applies at the next one.

**Recommendation: read-only in v1, but design the component so editing can be added** — this is the highest-value follow-up in the feature set.

### Q4.4 🟢 What does the plan do when the run ends?

Collapse to a summary? Stay expanded? What if items are left `pending` because the agent gave up (the continuation guard caps at 2 retries and then returns) — do we visibly mark "the agent stopped with 3 items outstanding"?

That last one matters: silently abandoning plan items is the failure ml-intern explicitly documents, and surfacing it is what stops a user thinking the task finished.

---

## §5. Long-running and background runs

### Q5.1 🔴 How long is a run allowed to last?

Minutes, hours, or days? This sets the engineering budget for everything: heartbeats, reaping, pause lifetimes, sandbox teardown, notification design.

An 8-hour training job is a normal ML Intern run. Is HuggingChat willing to hold a conversation in "running" state for 8 hours? Overnight? Over a weekend?

### Q5.2 🟠 How many concurrent runs per user?

Agentic runs hold server resources and remote compute. Is there a cap? Different for free vs. Pro? What's the message when they hit it?

### Q5.3 🟠 What do we notify on, and through what channel?

In-app toasts already exist but only fire with a tab open. For walk-away runs the candidates are Web Push and email.

Events worth notifying: **approval needed** (highest value — an unattended run blocked on a click is dead until someone notices), run complete, run failed, spend threshold crossed.

Questions: which channels ship? Opt-in or opt-out? Per-event granularity or one switch? Do we need a notification-settings surface, and does that exist today?

**Recommendation: Web Push, opt-in at the moment the user starts their first long run** ("this will take a while — want us to ping you?"). That's the moment the value is obvious.

### Q5.4 🟠 What does a running conversation look like in the sidebar?

A live indicator? Progress ("step 4 of 7")? A "needs your input" badge for a pending approval? The sidebar is how a user with three runs going keeps track — this may be the single most important surface for the walk-away story.

### Q5.5 🟢 What if the user never comes back?

A run pauses for approval and the user closes the tab for a week. We're holding a paused generation, possibly a live sandbox, possibly a running job. Do we auto-cancel? After how long? Do we notify before cancelling?

---

## §6. Compute lifecycle

### Q6.1 🔴 Should Stop cancel remote work?

Genuinely ambiguous, and it's a money question either way. Pressing Stop today just stops streaming. If the agent has submitted an 8-hour A100 job:

- **Cancel it** — matches "stop means stop", but destroys work the user may have wanted (the job is running fine; they just wanted the chat to stop narrating).
- **Leave it running** — matches "the job is a real thing that outlives the chat", but the user pressed Stop and is still being billed.
- **Ask** — a third modal at the worst possible moment.

**Recommendation: leave jobs running, cancel sandboxes, and say so explicitly in the stop confirmation** ("Stopped. Your training job `xyz` is still running — view / cancel"). But this needs a real decision; the two resources genuinely differ (a sandbox is scaffolding, a job is the deliverable).

### Q6.2 🔴 When does a sandbox get torn down?

A conversation has no "end". ml-intern ties the sandbox to a session and tears it down at session end, and _still_ leaks enough Spaces to need an admin sweeper (they observed 2,310 orphans in one day).

Options: idle timeout after last message; on conversation close/delete; explicit user action; never (rely on HF's own Space sleep).

**This needs an answer before the sandbox tool group is enabled, not after.** Idle sandboxes cost money on the user's account.

### Q6.3 🟠 Do users see and control their running compute?

Is there a "Runs" surface — jobs and sandboxes across conversations, with status and a kill switch? Or is everything only visible inside the conversation that started it?

The Hub already has its own Jobs and Spaces pages. Do we link out rather than rebuild? That's cheaper and arguably correct, but it means a user's running compute is invisible from HuggingChat.

### Q6.4 🟢 Whose namespace does everything land in?

Jobs bill to a namespace (personal or an org the user belongs to); repos are created somewhere; sandboxes are Spaces in someone's account. ml-intern surfaces a namespace picker. chat-ui already has a `billingOrganization` setting for inference.

Do we reuse `billingOrganization` for compute, ask separately, or always use personal? And do users understand that a chat conversation is about to create real repos in their account?

---

## §7. Setup friction

### Q7.1 🔴 Do users have to configure `huggingface.co/settings/mcp`?

The HF MCP server's Sandbox / Jobs / Contribute-Repos tool groups are **per-user opt-in on a settings page outside HuggingChat.** A user who never visits it gets read-only tools and the whole feature silently degrades.

Options: (a) drive tool selection per-request via the server's `?bouquet=`/`?mix=` parameters — needs confirmation from the hf-mcp-server team that this is supported and stable for our case; (b) onboard users to the settings page with a "you need to enable these" step; (c) ship read-only (option A in Q0.1) and sidestep it entirely.

**This is the single biggest external dependency in the project.** If (a) isn't available, ML Intern mode has a multi-step out-of-product setup, which changes the product substantially. Worth resolving before committing to a scope.

### Q7.2 🔴 When do we ask for the extra OAuth scopes?

Jobs and repo writes need scopes we don't currently request. Adding them to the standard set **logs every existing user out**.

Options: add now and absorb one mass re-login; request incrementally when a user first enables the mode; run two OAuth configurations.

Whichever we pick, there's a user-facing consent moment where someone is asked to grant a chat app write access to their Hub account and the ability to spend their credits. What does that screen say?

### Q7.3 🟢 What's the "you can't do this" state?

A free user with no credits enables ML Intern mode and asks it to fine-tune something. Where do they hit the wall — at mode entry, at the approval card, or at a 402 mid-run? Earlier is kinder. Latest is the current default (nothing checks up front).

---

## §8. The research sub-agent

### Q8.1 🟠 Is it visible or opaque?

The sub-agent can run 60 tool calls over several minutes. Options: a single "Researching…" spinner; a collapsed block with live progress lines ("read 4 papers, 12 repos"); a fully expandable transcript.

A silent multi-minute gap will read as a hang. But the whole point of the sub-agent is that its output _doesn't_ enter the main context — showing everything undercuts the "here's a clean summary" value.

**Recommendation: collapsed block with live progress, expandable to the full transcript.** Progress is essential; depth is optional.

### Q8.2 🟠 Does it need its own confirmation?

One `research` call can consume ~190K tokens of the user's inference credits — potentially more than several tool calls we _do_ gate. But prompting before every research call would be maddening and would break the doctrine.

Options: never prompt (covered by the spend threshold in §3); prompt on the first one per conversation; give it its own token budget with a "keep going?" at the ceiling.

### Q8.3 🟢 Do we show its sources?

The research output is a synthesised recipe. Do we surface the papers/repos it read as citations the user can click? That's a trust feature, and this feature's credibility rests on "it read the actual literature."

---

## §9. Elicitation and third-party servers

### Q9.1 🟠 Do server-initiated questions look the same as our approval cards?

MCP elicitation lets a server ask the _user_ a form question mid-tool-call ("which dataset config?"). Mechanically it's the same pause; semantically it's different — a question, not a permission request.

Same component with different framing, or a distinct one? Users need to be able to tell "the tool needs information" from "the tool wants permission to spend your money."

### Q9.2 🟠 How much do we trust a server to render UI in our product?

An elicitation request is a JSON schema that we turn into a form inside HuggingChat. A malicious or sloppy third-party server can put arbitrary text in field labels and descriptions — including text designed to look like it came from us.

Do we: render elicitation only for trusted servers (HF's own) in v1? Always show a "this question is from _{server}_" attribution? Cap field counts and text lengths?

**Recommendation: HF's server only in v1, with attribution, and revisit before opening it up.**

### Q9.3 🟢 Do we ever let a server use our LLM?

MCP sampling lets a server ask the client's model to do work — billed to the user. Powerful (a server could run its own sub-agent) and it hands an external party a budget. Ship never, ship with per-server consent, or ship with a hard token cap?

---

## §10. Resources and skills

### Q10.1 🟠 Are resources user-facing or agent-only?

The HF server exposes **skills** as `skill://` resources — procedural knowledge like "how to actually fine-tune with TRL". Two possible consumers:

- **Agent-only**: the model pulls skills mid-run; users never see the mechanism.
- **User-facing**: an `@`-style picker to attach a resource, dataset, or repo to a message.

The second is a whole feature (picker UI, search, preview) and arguably the more broadly valuable one — it's not ML-Intern-specific at all. Are they the same project or two?

### Q10.2 🟢 Do we show which skills a run used?

Part of the same transparency question as Q8.3.

---

## §11. Failure and partial results

### Q11.1 🟠 What does a failed long run look like?

A run can end by: iteration budget exhausted, compaction failed (hard stop — the alternative is a documented ~$3-per-retry infinite loop), provider error after retries, job failed, user aborted, pod died and got reaped.

Does the user see a generic error, or do we distinguish these? A run that did 40 useful rounds and then hit the ceiling is very different from one that failed on the first call — and today both would look identical.

### Q11.2 🟠 Is partial work presented as a result?

If the agent trained a model, pushed it, and _then_ the run failed, the user has a working model. Do we surface "here's what was produced before this failed", or does a failed run just look failed?

### Q11.3 🟢 Can a failed run be resumed?

Or does the user re-ask? Given a run may represent hours and real money, "resume from where it stopped" is high value — and it's much easier to design for now than to retrofit.

---

## §12. Sharing, export, and provenance

### Q12.1 🟠 What appears in a shared conversation?

Shared conversations currently show messages. An ML Intern conversation's tool trail contains repo names, job ids, dataset paths, namespaces, and possibly private repo contents.

Do shares include the tool trail (useful — the whole point is showing your work), strip it, or offer a choice? Today's default would leak it.

### Q12.2 🟢 Do we tag what the agent creates?

ml-intern stamps every repo it produces with a tag, a provenance section in the README, and membership in a session collection. Do we do the equivalent with a `huggingchat` tag?

It's good for attribution and discovery. It also means we're editing the user's README without them asking. Opt-in, opt-out, or always?

### Q12.3 🟢 Do we want trajectories for training/KPIs?

ml-intern uploads every run to a Hub dataset feeding SFT and KPI pipelines. HuggingChat has `shareConversationsWithModelAuthors` as an existing consent surface. Do we reuse it, or does a full agentic trajectory (with tool arguments that may contain repo paths and script contents) need its own explicit consent?

---

## Appendix A — work that needs no product input

This can start today, in parallel with the discussion above. All of it is correctness or protocol work with no user-visible decision attached:

**Correctness fixes** (all are current bugs)

- `isError` is never read — MCP tool errors are reported to the user _and the model_ as successes.
- Truncated tool arguments (`finish_reason: "length"`) parse to `{}` and the tool is dispatched with empty args.
- Any error in the agentic flow silently re-runs the whole turn with no tools, discarding completed work. Same for hitting the 10-round cap.
- A non-retryable 400 (e.g. a provider rejecting `reasoning_effort`) kills the turn. The OpenAI SDK already retries the _retryable_ statuses, so this is about healing the ones it can't, not adding a retry ladder.

**Tool-trail persistence and replay** — storing assistant `tool_calls` + `role:"tool"` results and reconstructing them into wire format, plus dangling-tool-call repair. Invisible to users; unblocks everything else.

**MCP client protocol surface** — declaring client capabilities, plumbing tool annotations through, handling non-text content blocks and `structuredContent`, `resources/list` + `resources/read` plumbing (the _picker_ is a product question; the client support isn't).

**Loop internals** — configurable iteration budget, terminal states, doom-loop detection, malformed-argument recovery.

**Compaction** — token accounting and the summarisation pass. Only the _failure_ messaging (Q11.1) is product-facing.

**Cost estimation library** — the price catalog and estimator. Only its _presentation_ (§3) is a product question.

---

## Appendix B — questions for the hf-mcp-server team

Not product questions, but they gate product decisions and need answers from outside this team:

1. Can a client select tool groups per-request via `?bouquet=` / `?mix=`, or is `settings/mcp` the only path? (Blocks Q7.1, and therefore Q0.1.)
2. Is elicitation supported or planned on the HF server? Which tools would use it?
3. Is MCP `tasks` (2025-11-25) on the roadmap? It's the natural model for `hf_jobs run` and would remove our need to poll.
4. Are tool annotations (`readOnlyHint`/`destructiveHint`) populated today and are they considered stable enough to key an approval policy off?
5. What's the intended lifecycle for `hf_sandbox` instances — who reaps them, after how long, and is there an idle-cost model we should design around?
