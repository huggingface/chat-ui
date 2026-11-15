# /// script
# requires-python = ">=3.10"
# dependencies = ["huggingface_hub>=1.0", "pyarrow"]
# ///
"""refit ANSWER_TEMPERATURE in answerer.ts, see README.md

    OPENAI_API_KEY=... uv run evals/ml-intern/fit_answerer.py collect --out <dir>
    uv run evals/ml-intern/fit_answerer.py fit <dir>

fit minimises log loss against the annotator majority answer, soft labels flatten every answer
"""

import argparse
import json
import math
import os
import random
import time
import urllib.error
import urllib.request

LETTERS = "ABCDEFGHIJKLMNOP"
PER_SPLIT = 60
SYSTEM = "You answer one decision question about a state. Reply with the letter of the single best option, nothing else."


def questions(split):
    """one choice or yes/no question per state, with the annotator probabilities as gold"""
    import pyarrow.parquet as pq
    from huggingface_hub import hf_hub_download

    path = hf_hub_download("LocalLLaMA/typed-decisions", f"all/{split}-00000-of-00001.parquet", repo_type="dataset")
    rows = pq.read_table(path).to_pylist()
    random.Random(split).shuffle(rows)
    out = []
    for row in rows[: PER_SPLIT * 3]:
        qs, gold = json.loads(row["questions"]), json.loads(row["gold"])
        names = [k for k, v in qs.items() if v["type"] in ("choice", "noul") and k in gold]
        if not names:
            continue
        name = random.Random(row["id"]).choice(names)
        q = qs[name]
        keys = list(q["criteria"].keys()) if q.get("criteria") else ["true", "false"]
        labels = [f"{k}: {q['criteria'][k]}" if q.get("criteria") else k for k in keys]
        probs = gold[name]["probabilities"]
        out.append({
            "id": f"{row['id']}/{name}", "split": split,
            "prompt": f"State:\n{row['state']}\n\nQuestion: {q['instructions']}",
            "options": labels, "gold": [float(probs.get(k, 0)) for k in keys],
        })
        if len(out) == PER_SPLIT:
            break
    return out


def ask(base_url, model, token, q):
    lines = "\n".join(f"{LETTERS[i]}) {o}" for i, o in enumerate(q["options"]))
    body = {
        "model": model, "temperature": 0, "max_tokens": 1, "logprobs": True, "top_logprobs": 20,
        "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": f"{q['prompt']}\n\n{lines}\n\nAnswer:"}],
    }
    for attempt in range(10):
        req = urllib.request.Request(
            f"{base_url.rstrip('/')}/chat/completions", data=json.dumps(body).encode(),
            headers={"Authorization": f"Bearer {token}", "content-type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                data = json.load(r)
                provider = r.headers.get("x-inference-provider")
            content = (data["choices"][0].get("logprobs") or {}).get("content") or []
            if not content:
                return {"error": "no logprobs", "provider": provider}
            return {"top": [(t["token"], t["logprob"]) for t in content[0]["top_logprobs"]], "provider": provider}
        except urllib.error.HTTPError as err:
            if err.code != 429 and err.code < 500:
                return {"error": f"HTTP {err.code}"}
            time.sleep(float(err.headers.get("retry-after") or 5) + attempt)
    return {"error": "still failing after 10 tries"}


def option_logprobs(top, n):
    """the same readout as optionLogprobs in answerer.ts"""
    floor = min(lp for _, lp in top) - 1.0
    out = []
    for i in range(n):
        matches = [lp for tok, lp in top if tok.strip().strip("()*.").upper() == LETTERS[i]]
        out.append(math.log(sum(math.exp(lp) for lp in matches)) if matches else floor)
    return out


def softmax(xs, t):
    m = max(x / t for x in xs)
    e = [math.exp(x / t - m) for x in xs]
    return [x / sum(e) for x in e]


def metrics(rows, t):
    nll = 0.0
    bins = [[0, 0.0, 0.0] for _ in range(10)]
    for r in rows:
        p = softmax(r["lp"], t)
        majority = max(range(len(r["gold"])), key=r["gold"].__getitem__)
        nll -= math.log(max(p[majority], 1e-12))
        top = max(range(len(p)), key=p.__getitem__)
        b = bins[min(9, int(p[top] * 10))]
        b[0] += 1
        b[1] += p[top]
        b[2] += top == majority
    n = len(rows)
    return {
        "n": n,
        "accuracy": sum(b[2] for b in bins) / n,
        "mean_confidence": sum(b[1] for b in bins) / n,
        "ece": sum(abs(b[1] - b[2]) for b in bins if b[0]) / n,
        "nll": nll / n,
    }


def collect(args):
    token = os.environ["OPENAI_API_KEY"]
    os.makedirs(args.out, exist_ok=True)
    path = os.path.join(args.out, "calls.jsonl")
    done = {json.loads(line)["id"] for line in open(path)} if os.path.exists(path) else set()
    qs = questions("train") + questions("test")
    print(f"{len(qs)} questions, {len(done)} already done", flush=True)
    with open(path, "a") as fh:
        for i, q in enumerate(qs):
            if q["id"] in done:
                continue
            res = ask(args.base_url, args.model, token, q)
            fh.write(json.dumps({**q, **res, "model": args.model}) + "\n")
            fh.flush()
            if i % 10 == 0:
                print(f"{i + 1}/{len(qs)} {res.get('provider')} {res.get('error', '')}", flush=True)


def fit(args):
    rows = []
    for line in open(os.path.join(args.dir, "calls.jsonl")):
        r = json.loads(line)
        if "top" in r and r.get("split") in ("train", "test"):
            r["lp"] = option_logprobs(r["top"], len(r["options"]))
            rows.append(r)
    by = {s: [r for r in rows if r["split"] == s] for s in ("train", "test")}
    grid = [0.25 * 1.1**k for k in range(60)]
    best = min(grid, key=lambda t: metrics(by["train"], t)["nll"])
    report = {"temperature": round(best, 2)}
    print(f"ANSWER_TEMPERATURE = {best:.2f}, fitted on {len(by['train'])} train questions")
    for split, split_rows in by.items():
        if not split_rows:
            continue
        raw, cal = metrics(split_rows, 1.0), metrics(split_rows, best)
        report[split] = {"raw": raw, "fitted": cal}
        print(f"\n{split} ({raw['n']}): agreement with the majority answer {raw['accuracy']:.0%}")
        for name, m in (("raw", raw), ("fitted", cal)):
            print(f"  {name:7s} mean confidence {m['mean_confidence']:.2f}  ECE {m['ece']:.3f}  NLL {m['nll']:.3f}")
    json.dump(report, open(os.path.join(args.dir, "report.json"), "w"), indent=1)


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("collect")
    c.add_argument("--out", required=True)
    c.add_argument("--model", default="google/gemma-4-31B-it:novita")
    c.add_argument("--base-url", default=os.environ.get("OPENAI_BASE_URL", "https://router.huggingface.co/v1"))
    f = sub.add_parser("fit")
    f.add_argument("dir")
    a = p.parse_args()
    collect(a) if a.cmd == "collect" else fit(a)


if __name__ == "__main__":
    main()
