# ML Intern decision evals

Checks whether a change to ML Intern's prompt, tools or history replay makes the agent decide
better or worse at moments where it often gets it wrong. Each case is a real conversation cut just
before one decision. The model is sampled again from that point under two versions of the code,
and the two versions are compared on the same cases.

A full comparison takes a couple of hours, so it runs on demand (a PR label, see below) or on a
schedule, not on every PR.

## Families

| Family              | Cut before                             | Right call                            |
| ------------------- | -------------------------------------- | ------------------------------------- |
| `first-gpu-job`     | the first GPU job                      | develop the script in a sandbox first |
| `after-job-failure` | the step after a job failed            | reproduce the failure in a sandbox    |
| `after-oom`         | the step after a CUDA OOM              | change memory use, not only the GPU   |
| `after-stale-api`   | the step after a changed-library error | look up the real API before editing   |

The first two come from user feedback (2026-10-24) about the agent submitting lots of failing
jobs instead of first developing in a sandbox.

## Data

Cases are real users' conversations. They never go in this repo, in issues or in PRs. They live in
the private dataset `ml-intern-internal/ml-intern-decision-cases`, with each case's reference label
in `references.jsonl`. Secrets are redacted (`redact.ts`); nothing else is.

```bash
hf download ml-intern-internal/ml-intern-decision-cases --repo-type dataset --local-dir <cases>
```

## Running a comparison

Run one arm per checkout: the base (for example the last release, or main) and the change. Use the
same arguments for both, so they sample the same cases.

```bash
npm run eval:run -- --cases <cases> --out <runs>/<arm>
```

The defaults are the full size: 20 cases per family, 10 samples each, `zai-org/GLM-5.3-Flash` on
novita. Set `EXA_API_KEY` in the environment so the Exa tools are offered as in production. The
run is resumable, and `--dump-requests` saves each request to diff what two arms sent.

```bash
npm run eval:compare -- --cases <cases> --a <runs>/<base> --b <runs>/<change> [--target <family>]
```

`--target` names the family the change set out to improve. Name it before running.

An arm is fixed by its commit, so the base's run can be reused for every change compared against
that commit.

### In CI

Add the `decision-evals` label to a PR. `.github/workflows/decision-evals.yml` then:

1. samples the PR's head and its merge-base at full size;
2. posts the verdict and totals as a PR comment, edited in place on reruns;
3. pushes every sample, judgement and report to the private dataset
   `ml-intern-internal/ml-intern-decision-eval-runs`;
4. removes the label, so adding it again reruns.

The comment holds totals only, never a case's content. A regression fails the job.

- **Naming a target:** put a line like `Decision eval target: after-job-failure` in the PR description.
- **Caching:** arms are stored under `arms/<commit>-<settings>-cases<revision>`, so a base already
  run is reused by every PR on it.
- **Bases that can't be compared:** a merge-base older than this harness has nothing to compare
  against, and the job says so.
- **Fork PRs:** they get no secrets, so they don't run.

| Repository setting                              | What it is                                              |
| ----------------------------------------------- | ------------------------------------------------------- |
| `DECISION_EVALS_HF_TOKEN` (secret)              | reads the cases, writes the results, pays for inference |
| `DECISION_EVALS_EXA_API_KEY` (secret, optional) | offers the Exa tools, as production does                |
| `DECISION_EVALS_BILL_TO` (variable, optional)   | org billed for inference (`X-HF-Bill-To`)               |

#### The token

The Hub MCP server lists only the tools a token may use, so the token has to be able to do
everything production's users can. Each arm stops before sampling if any intern-bouquet tool is
missing, and names the missing ones (`--require-hub-tools`).

The eval only lists the tools and never calls them. Still, give the token to a dedicated bot
account that is a member of `ml-intern-internal` and owns nothing else. It needs:

- **For the bot's own namespace:**
  - read and write repos, and create repos (`hf_fs`, `hf_fs_write`, `create_repo`,
    `hub_repo_details`);
  - start and manage jobs (`hf_jobs`), plus whatever the sandbox tools need; if a scope is
    missing, the guard names the tools that went with it;
  - make calls to Inference Providers (sampling and the judge).
- **For repos in `ml-intern-internal`:**
  - read `ml-intern-decision-cases`;
  - write `ml-intern-decision-eval-runs`;
  - with `DECISION_EVALS_BILL_TO` set to the org, make inference calls on its behalf.

### What a comparison does

- **Builds the request** with the app's own code (`requestPrompt.ts`, shared with `runMcpFlow`), so
  the arm measures that checkout's prompt and tools. `run.ts` restarts itself with production's
  settings from `chart/env/prod.yaml`.
  - Left out, the same in both arms: the session state block, the plan, the stored history window,
    uploaded files and tool images. They need production's database.
  - The budget is fixed at $25.
- **Judges every sample** with DeepSeek-V4.1-Flash on novita (`judge.ts`). The judge doesn't see
  which arm a sample came from.
  - A sample is one step. When the step hasn't committed yet in `after-job-failure` and
    `first-gpu-job`, the judge labels the plan the step states.
  - `labels.ts` also labels every sample, as a free cross-check.
- **Compares the arms case by case**, with a permutation p and an interval that resamples both
  conversations and samples (`stats.ts`).

### The verdict (`verdict.ts`)

- **no-change**: both arms sent the same prompt and tools.
- **inconclusive**: one of these moved between arms beyond the limit, which means the judge reads
  the arms differently:
  - the share of samples without a verdict;
  - the judge's agreement with `labels.ts`.

  The limit is 10 points at full size and wider for smaller runs.

- **regression**: a family is worse in B with Holm-adjusted p < 0.05 across the four families. The
  command then exits 1, so a scheduled run can alert on it.
- **pass**: otherwise.
- **Improvement** is reported only for `--target`, at p < 0.05.
- The pooled "all" row is shown but never tested: it mixes families with very different baselines.

A run below the full size is marked as a preview.

### Calibration (2026-10-29)

Four identical arms (10 cases × 5 samples) gave six A/A comparisons.

- **Uncorrected p:** 1 of 24 family results was below 0.05, and the pooled row twice.
- **Holm-corrected:** none were.
- **Chance spread in points:** first-gpu-job 1, after-job-failure 4, after-oom 7, after-stale-api 9.
- **Full size:** catches roughly a 15-point change on after-oom and after-stale-api, and about 5
  points on the other two.
- **Cost:** about $36 at list price with both arms fresh, about half that when the base arm is
  reused. Requests run about 160k prompt tokens, mostly served from the provider's cache.

## Building the cases

These steps run only when the cases are re-mined. They need the daily conversation exports from
`hf://buckets/ml-intern-internal/huggingchat-conversations/exports/`.

1. **Mine** the cases:
   ```bash
   npm run eval:mine -- --exports <dir> --out <cases> [--seeds seeds.json]
   ```
2. **Label** every case with the judge and write the reference labels and baselines:
   ```bash
   npm run eval:annotate -- --cases <cases> --all
   ```
3. **Hand-check** a sample of cases per family in a local page:
   ```bash
   npm run eval:review -- --cases <cases>
   ```
   Reviewer verdicts take precedence over the judge's labels.

## Running locally from a worktree

In a worktree under `.claude/`, the worktree's own `vite-node` can't load the files. Use the main
checkout's instead: `../../../node_modules/.bin/vite-node`, with the options from `package.json`.
