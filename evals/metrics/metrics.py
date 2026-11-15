#!/usr/bin/env python3
"""ml intern production metrics from the daily conversation exports, the outcome evals run it too

    hf buckets sync hf://buckets/ml-intern-internal/huggingchat-conversations/exports <exports>
    python3 -I evals/metrics/metrics.py <exports> --out <dir> [--since 2026-10-01] [--until 2026-11-02]

a job outcome is known only from a harness event or a check_job report, other jobs count as unknown
updates carry no timestamps, so each is timed by the last turn start, harness event or job id before it
"""

import argparse
import csv
import gzip
import json
import os
import re
import statistics
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

JOB_ID = re.compile(r"\b[0-9a-f]{24}\b")
FAILED_REPORT = re.compile(r"^[\s>*-]*status\**\s*:?\s*\**\s*failed\b", re.I | re.M)
FINISHED_REPORT = re.compile(r"^[\s>*-]*status\**\s*:?\s*\**\s*(finished|completed)\b", re.I | re.M)
SANDBOX_TOOLS = {"hf_sandbox_exec", "hf_sandbox_fs", "sandbox_task"}
SANDBOX_FIRST_REFUSAL = "Sandbox first:"
PUT_PATH = re.compile(r"Path: `([^`]+)`")
PUT_TYPE = re.compile(r"Type: `(\w+)`")
# a script or readme put on the hub is a step, not something the user can try
DATA_EXTENSIONS = (
    ".parquet", ".jsonl", ".json", ".csv", ".arrow", ".safetensors", ".bin", ".gguf", ".pt",
    ".png", ".jpg", ".jpeg", ".gif", ".mp4", ".wav", ".mp3", ".html",
)
SUBMITTED = ("Job started:", "Created sandbox")
HUB_WORK_TOOLS = {"hf_jobs", "hf_sandbox", "create_repo", "hf_fs_write", "request_review"}


def oid(value):
    return value["$oid"] if isinstance(value, dict) else str(value)


def when(value):
    """export dates are {"$date": iso} or epoch ms"""
    if isinstance(value, dict):
        value = value.get("$date")
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value / 1000, timezone.utc)
    if isinstance(value, str):
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    return None


def args_of(update):
    raw = update.get("argumentsRaw")
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass
    return update.get("call", {}).get("parameters") or {}


def output_text(update):
    if update.get("subtype") == "error":
        return str(update.get("message", ""))
    outputs = (update.get("result") or {}).get("outputs") or []
    return "\n".join(str(o.get("text", "")) for o in outputs if isinstance(o, dict))


def token_after(tokens, flag):
    return tokens[tokens.index(flag) + 1] if flag in tokens and tokens.index(flag) + 1 < len(tokens) else None


def is_gpu(flavor):
    return bool(flavor) and not flavor.startswith("cpu")


def load(exports, since, until):
    """latest copy of each ml intern conversation, a file holds the ones updated that day"""
    latest = {}
    for name in sorted(os.listdir(exports)):
        if not name.endswith(".ndjson.gz"):
            continue
        with gzip.open(os.path.join(exports, name), "rt") as fh:
            for line in fh:
                if '"mlAssistant"' not in line:
                    continue
                conv = json.loads(line)
                if not conv.get("mlAssistant"):
                    continue
                created = when(conv.get("createdAt"))
                if created is None or (since and created < since) or (until and created >= until):
                    continue
                key = oid(conv["_id"])
                updated = when(conv.get("updatedAt")) or created
                if key not in latest or updated >= latest[key][0]:
                    latest[key] = (updated, conv)
    return [conv for _, conv in latest.values()]


def events(conv):
    """the conversation updates in order, each with the last timestamp seen before it"""
    messages = sorted(conv.get("messages", []), key=lambda m: when(m.get("createdAt")) or datetime.min.replace(tzinfo=timezone.utc))
    out = []
    for m in messages:
        clock = when(m.get("createdAt"))
        if m.get("from") == "user":
            out.append(("user", clock, m))
            continue
        for u in m.get("updates") or []:
            if u.get("type") == "turnState" and u.get("serverNow"):
                clock = when(u["serverNow"])
            if u.get("type") == "harnessEvent":
                stamps = [when(e.get("at")) for e in u.get("events") or [] if e.get("at")]
                if stamps:
                    clock = max(stamps)
            if u.get("type") == "tool" and u.get("subtype") == "result":
                text = output_text(u)
                found = JOB_ID.search(text) if text.startswith(SUBMITTED) else None
                if found:
                    # a hub id is an ObjectId, its first four bytes are when it was made
                    made = datetime.fromtimestamp(int(found.group(0)[:8], 16), timezone.utc)
                    if clock is None or clock - timedelta(minutes=5) <= made <= clock + timedelta(days=7):
                        clock = max(clock, made) if clock else made
            out.append(("update", clock, u))
    return out


def measure(conv):
    seq = events(conv)
    calls = {}
    jobs = []  # in submission order
    by_id = {}
    sandbox_creates = []  # index and flavor pairs
    sandbox_activity = []  # indices of any sandbox use
    artifacts = []
    refusals = Counter()
    first_user = None
    hub_work = False

    for i, (kind, clock, item) in enumerate(seq):
        if kind == "user":
            first_user = first_user or clock
            continue
        u = item
        t, sub = u.get("type"), u.get("subtype")
        if t == "tool" and sub == "call":
            calls[u.get("uuid")] = (u.get("call", {}).get("name"), args_of(u))
            name = calls[u.get("uuid")][0]
            hub_work = hub_work or name in HUB_WORK_TOOLS
            if name in SANDBOX_TOOLS:
                sandbox_activity.append(i)
            continue
        if t == "tool" and sub in ("result", "error"):
            name, args = calls.get(u.get("uuid"), (None, {}))
            text = output_text(u)
            ok = sub == "result" and (u.get("result") or {}).get("status") == "success"
            if sub == "error" and text.startswith(SANDBOX_FIRST_REFUSAL):
                refusals["sandbox-first"] += 1
            if name == "hf_jobs" and args.get("operation") in ("run", "uv") and ok:
                job_args = args.get("args") if isinstance(args.get("args"), dict) else {}
                found = JOB_ID.search(text)
                job = {
                    "id": found.group(0) if found else None,
                    "flavor": job_args.get("flavor") or "cpu-basic",
                    "index": i,
                    "outcome": None,
                    "known_at": None,
                }
                jobs.append(job)
                if job["id"]:
                    by_id[job["id"]] = job
            elif name == "hf_sandbox" and args.get("cmd") == "create" and ok:
                tokens = [x for x in args.get("args") or [] if isinstance(x, str)]
                sandbox_creates.append((i, token_after(tokens, "--flavor") or "?"))
                sandbox_activity.append(i)
            elif name == "check_job" and ok:
                job = by_id.get(str(args.get("job_id", "")).strip())
                if job and job["outcome"] is None:
                    if FAILED_REPORT.search(text):
                        job["outcome"], job["known_at"] = "ERROR", i
                    elif FINISHED_REPORT.search(text):
                        job["outcome"], job["known_at"] = "COMPLETED", i
            elif name == "hf_fs_write" and ok and args.get("cmd") == "put":
                path = (PUT_PATH.search(text) or [None, ""])[1].replace("\\_", "_").lower()
                repo_type = (PUT_TYPE.search(text) or [None, ""])[1]
                if repo_type == "space" or path.endswith(DATA_EXTENSIONS):
                    artifacts.append(clock)
            elif name == "request_review" and ok:
                artifacts.append(clock)
            continue
        if t == "harnessEvent":
            for e in u.get("events") or []:
                if e.get("kind") != "job":
                    continue
                job = by_id.get(e.get("jobId"))
                if job and job["outcome"] in (None, "RUNNING"):
                    job["outcome"], job["known_at"] = e.get("to"), i
                if any(p.get("status") == "pushed" for p in e.get("pushes") or []):
                    artifacts.append(clock)

    gpu_jobs = [j for j in jobs if is_gpu(j["flavor"])]
    failed = [j for j in jobs if j["outcome"] == "ERROR"]
    completed = [j for j in jobs if j["outcome"] == "COMPLETED"]

    streak = longest = 0
    for j in jobs:
        if j["outcome"] == "ERROR":
            streak += 1
            longest = max(longest, streak)
        elif j["outcome"] == "COMPLETED":
            streak = 0

    first_success = next((k for k, j in enumerate(jobs) if j["outcome"] == "COMPLETED"), None)
    failed_before_success = sum(1 for j in jobs[: first_success if first_success is not None else len(jobs)] if j["outcome"] == "ERROR")

    sandbox_first = same_flavor = None
    if gpu_jobs:
        first = gpu_jobs[0]["index"]
        sandbox_first = any(at < first for at, _ in sandbox_creates)
        same_flavor = any(at < first and f == gpu_jobs[0]["flavor"] for at, f in sandbox_creates)

    after_failure = Counter()
    for j in failed:
        known = j["known_at"]
        next_job = next((x["index"] for x in jobs if x["index"] > known), None)
        next_sandbox = next((x for x in sandbox_activity if x > known), None)
        if next_sandbox is not None and (next_job is None or next_sandbox < next_job):
            after_failure["sandbox"] += 1
        elif next_job is not None:
            after_failure["resubmit"] += 1
        else:
            after_failure["stopped"] += 1

    first_artifact = min((a for a in artifacts if a), default=None)
    harness = next((m.get("harness") for m in conv.get("messages", []) if m.get("harness")), None) or {}
    created = when(conv.get("createdAt"))
    return {
        "conversation": oid(conv["_id"]),
        "created": created.date().isoformat(),
        "week": (created - timedelta(days=created.weekday())).date().isoformat(),
        "prompt": harness.get("prompt", ""),
        "model": harness.get("model", ""),
        "hub_work": int(hub_work),
        "jobs": len(jobs),
        "gpu_jobs": len(gpu_jobs),
        "failed": len(failed),
        "completed": len(completed),
        "unknown": sum(1 for j in jobs if j["outcome"] not in ("ERROR", "COMPLETED", "CANCELED")),
        "longest_failed_streak": longest,
        "failed_before_first_success": failed_before_success,
        "jobs_to_first_success": "" if first_success is None else first_success + 1,
        "sandbox_creates": len(sandbox_creates),
        "gpu_sandbox_creates": sum(1 for _, f in sandbox_creates if is_gpu(f)),
        "sandbox_before_first_gpu_job": "" if sandbox_first is None else int(sandbox_first),
        "sandbox_on_flavor_before_first_gpu_job": "" if same_flavor is None else int(same_flavor),
        "after_failure_sandbox": after_failure["sandbox"],
        "after_failure_resubmit": after_failure["resubmit"],
        "after_failure_stopped": after_failure["stopped"],
        "sandbox_first_refusals": refusals["sandbox-first"],
        "minutes_to_first_artifact": ""
        if not (first_artifact and first_user)
        else round(max(0.0, (first_artifact - first_user).total_seconds() / 60), 1),
    }


def pct(n, d):
    return f"{100 * n / d:.0f}%" if d else "n/a"


def quantiles(values):
    if not values:
        return "n/a"
    values = sorted(values)
    q = lambda p: values[min(len(values) - 1, int(p * len(values)))]
    return f"{statistics.median(values):.0f} (p25 {q(0.25):.0f}, p75 {q(0.75):.0f})"


def median(values):
    return f"{statistics.median(values):.0f}" if values else "n/a"


def table(rows):
    """one column per group, over compute sessions, the conversations that launched a job or sandbox"""
    measures = []
    for label, everything in rows:
        group = [r for r in everything if r["jobs"] or r["sandbox_creates"]]
        with_jobs = [r for r in group if r["jobs"]]
        jobs = sum(r["jobs"] for r in group)
        failed = sum(r["failed"] for r in group)
        known = sum(r["failed"] + r["completed"] for r in group)
        gpu = [r for r in group if r["sandbox_before_first_gpu_job"] != ""]
        after = sum(r["after_failure_sandbox"] + r["after_failure_resubmit"] for r in group)
        workers = [r for r in everything if r["hub_work"]]
        times = [r["minutes_to_first_artifact"] for r in workers if r["minutes_to_first_artifact"] != ""]
        measures.append(
            (
                label,
                [
                    len(everything),
                    len(group),
                    len(with_jobs),
                    median([r["jobs"] for r in with_jobs]),
                    pct(known, jobs),
                    pct(failed, known),
                    median([r["failed"] for r in with_jobs]),
                    median([r["failed_before_first_success"] for r in with_jobs if r["completed"]]),
                    pct(sum(1 for r in with_jobs if r["longest_failed_streak"] >= 2), len(with_jobs)),
                    pct(sum(1 for r in with_jobs if r["longest_failed_streak"] >= 3), len(with_jobs)),
                    pct(sum(r["sandbox_before_first_gpu_job"] for r in gpu), len(gpu)) + f" of {len(gpu)}",
                    pct(sum(r["sandbox_on_flavor_before_first_gpu_job"] for r in gpu), len(gpu)),
                    pct(sum(r["after_failure_sandbox"] for r in group), after) + f" of {after}",
                    pct(sum(r["gpu_sandbox_creates"] for r in group), sum(r["sandbox_creates"] for r in group)),
                    sum(r["sandbox_first_refusals"] for r in group),
                    len(workers),
                    pct(len(times), len(workers)),
                    quantiles(times),
                ],
            )
        )
    names = [
        "ML Intern conversations",
        "compute sessions (a job or sandbox)",
        "with a job",
        "jobs per session with a job, median",
        "jobs with a known end",
        "jobs failed, of those with a known end",
        "failed jobs per session with a job, median",
        "failed jobs before the first success, median",
        "sessions with 2+ failed jobs in a row",
        "sessions with 3+ failed jobs in a row",
        "first GPU job had a sandbox before it",
        "first GPU job had a sandbox on its flavor before it",
        "after a failed job, a sandbox before the next job",
        "sandboxes created on a GPU",
        "sandbox-first refusals",
        "Hub sessions (tried a Hub write or compute)",
        "Hub sessions with an artifact",
        "minutes to first artifact, median",
    ]
    head = "| measure | " + " | ".join(label for label, _ in measures) + " |"
    rule = "|---|" + "---|" * len(measures)
    lines = [head, rule]
    for k, name in enumerate(names):
        lines.append(f"| {name} | " + " | ".join(str(values[k]) for _, values in measures) + " |")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("exports")
    parser.add_argument("--out", required=True)
    parser.add_argument("--since")
    parser.add_argument("--until")
    a = parser.parse_args()
    since = datetime.fromisoformat(a.since).replace(tzinfo=timezone.utc) if a.since else None
    until = datetime.fromisoformat(a.until).replace(tzinfo=timezone.utc) if a.until else None

    rows = [measure(c) for c in load(a.exports, since, until)]
    rows.sort(key=lambda r: (r["created"], r["conversation"]))
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, "conversations.csv"), "w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()) if rows else ["conversation"])
        writer.writeheader()
        writer.writerows(rows)
    with open(os.path.join(a.out, "conversations.json"), "w") as fh:
        json.dump(rows, fh, indent=1)

    weeks = defaultdict(list)
    for r in rows:
        weeks[r["week"]].append(r)
    first, last = (rows[0]["created"], rows[-1]["created"]) if rows else ("", "")
    label = lambda week: week if (datetime.fromisoformat(week) + timedelta(days=6)).date().isoformat() <= last else f"{week} (partial)"
    report = [
        "# ML Intern production metrics",
        "",
        f"ML Intern conversations created {first} to {last}, from the daily exports. Weeks start on Monday. "
        "Job and sandbox rows are over compute sessions, conversations that launched a job or a sandbox. "
        "Artifact rows are over Hub sessions, conversations that tried any Hub write or compute. "
        "An artifact is the first thing the user can try: a file on a Space, a data or model file put on the Hub, "
        "a repo a job pushed to, or a data review. Scripts and readmes do not count.",
        "",
        table([("all", rows)]),
        "",
        "## By week",
        "",
        table([(label(week), weeks[week]) for week in sorted(weeks)]),
        "",
    ]
    with open(os.path.join(a.out, "metrics.md"), "w") as fh:
        fh.write("\n".join(report))
    print("\n".join(report))
    print(f"{len(rows)} conversations -> {a.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
