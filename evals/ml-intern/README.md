# ML Intern outcome evals

Real tasks, run end to end against the real app, a pinned model and real HF Jobs. Where the
decision evals (`evals/decisions`) freeze a real conversation and judge one step, these let a whole
run play out, so they measure what only shows over a run: time to a usable artifact, failed jobs
on the way to a working one, whether the agent sandboxed on the job's own hardware, and what the
sandbox-first guard refuses.

## Tasks

Every task but the control is a trap: the obvious first attempt fails the way production runs
fail. The prompts are in `scenarios.ts`; `{repo}` and `{space}` become names unique to each run.

| task                   | trap                                                                                                     | hidden check (data the agent never sees)             |
| ---------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `mnist-1min`           | none, the control: a change that slows easy work shows here                                              | Trackio accuracy over 0.8                            |
| `full-finetune-oom`    | a full fine-tune of a 2.03B model on an a10g-small needs ~24 GB before activations                       | the pushed model loads and generates                 |
| `stale-trainer-args`   | `max_seq_length`, `evaluation_strategy` and `Trainer(tokenizer=)` are gone in trl 1.x / transformers 5.x | the pushed model loads and generates                 |
| `c4-tokenizer`         | C4's en config is hundreds of GB unless streamed, and nothing needs a GPU                                | the tokenizer loads, has a 32k vocab and round-trips |
| `arxiv-long-docs`      | inputs are whole papers and their length is never stated                                                 | accuracy of the pushed model on 100 test papers      |
| `imdb-three-artifacts` | three artifacts, so time to the last one; Space builds often fail                                        | the Space labels 8 of 10 held-out reviews            |
| `pretrain-too-big`     | ~5 days on an A100 against a $3 budget                                                                   | none: it should stop for the user before any GPU job |

Calibrate a new trap before relying on it: run the obvious solution by hand once to confirm the
trap fires, then run the task on main a few times. A trap the agent always avoids, or never
escapes, cannot show a change either way.

## Measures

Each run's conversation is written in the daily export's format and measured by
`evals/metrics/metrics.py`, the same script the weekly production report uses, so a number here
means what it means in production. On top of that the runner records when each artifact the task
asks for was first usable on the Hub (polled every minute), whether the agent stopped for the user
before its first GPU job, the cost settled from the Jobs API, and the hidden check, run as a CPU job
once the turn ends (`hidden_checks.py`, billed apart from the agent's budget).

`compare.ts` pairs two arms task by task. Headline measures are tested together with a Holm
correction: hidden check passed, made every artifact, minutes to every artifact (the task's
timeout when one never appears), failed jobs, sandbox on the job's flavor before the first GPU
job, and cost. The rest are shown, not tested. Intervals and p-values come from the decision evals'
paired bootstrap and within-task permutation (`evals/decisions/stats.ts`), with tasks as the unit.
At 7 tasks and 3 runs each, expect to see only large moves, like failed jobs halving.

Nothing here gates a merge. Run an A/A (two arms of the same commit) first to see the noise.

## Running

```bash
HF_TOKEN=hf_... npm run eval:ml-intern
HF_TOKEN=hf_... ML_EVAL_SCENARIO=mnist-1min,c4-tokenizer ML_EVAL_REPEATS=2 npm run eval:ml-intern
npm run eval:ml-intern:compare -- --a <base>/result.json --b <head>/result.json
```

Each run writes `result.json` (every task run, its checks, measures and trace), `summary.md`,
the conversations in the export format under `exports/` and their production measures under
`metrics/`, to `eval-output/ml-intern/<timestamp>` or `ML_EVAL_OUT`. The other settings are listed
at the top of `run.ts`.

The token pays for the jobs, so it needs job, sandbox and repo write permissions on an account
with credits. Runs push repos and Spaces named `ml-eval-<task>-<run>-r<n>` into its namespace and
leave them there. The token's value is replaced with `[HF_TOKEN]` in everything written.

In CI (`.github/workflows/ml-intern-eval.yml`) it runs nightly on main, once per task, and on a PR
when the `ml-intern-eval` label is added: the PR's head against its merge-base, three runs per task
per arm, with the totals in a PR comment. Runs go to the private dataset
`ml-intern-internal/ml-intern-outcome-eval-runs`, traces to a private Trackio Space.

## Cost

Estimates from list prices, to be replaced by measured numbers. A good run spends $0.02 to $1 on
compute (a10g-small is $1/h, l4x1 $0.80/h, cpu-upgrade $0.03/h) and about $1 on inference. Each
task's budget caps what a run stuck in a retry loop can spend. That comes to about $12 a night and
$60 to $100 for a PR comparison with both arms fresh.
