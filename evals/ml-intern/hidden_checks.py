# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "transformers>=5.22",
#     "peft>=0.21",
#     "torch",
#     "datasets>=5",
#     "tokenizers",
#     "gradio_client",
#     "huggingface_hub",
# ]
# ///
"""checks on what an outcome eval run left on the hub, with data the agent never saw

prints one RESULT line of json, with pass false and the error when a check cannot run

    generates <repo>
    tokenizer <repo> <vocab>
    classifier <repo> <dataset> <split> <n>
    space-sentiment <space> <n>
"""

import json
import random
import re
import sys
import traceback

SAMPLE_PARAGRAPH = (
    "The committee met on Tuesday to review the budget. Several members raised concerns about "
    "rising costs, and a vote was postponed until next month's session, when final numbers are due."
)


def generates(repo):
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    try:
        from peft import AutoPeftModelForCausalLM

        model = AutoPeftModelForCausalLM.from_pretrained(repo, dtype=torch.bfloat16)
    except Exception:
        model = AutoModelForCausalLM.from_pretrained(repo, dtype=torch.bfloat16)
    tokenizer = AutoTokenizer.from_pretrained(repo)
    inputs = tokenizer("The capital of France is", return_tensors="pt")
    out = model.generate(**inputs, max_new_tokens=16, do_sample=False)
    sample = tokenizer.decode(out[0][inputs["input_ids"].shape[1] :], skip_special_tokens=True)
    return {"pass": bool(sample.strip()), "sample": sample[:200]}


def tokenizer(repo, vocab):
    from transformers import AutoTokenizer

    tok = AutoTokenizer.from_pretrained(repo)
    size = len(tok)
    ids = tok(SAMPLE_PARAGRAPH, add_special_tokens=False)["input_ids"]
    # add_prefix_space decodes with one leading space
    round_trip = tok.decode(ids).removeprefix(" ") == SAMPLE_PARAGRAPH
    # special tokens and byte fallbacks sit on top of the merges
    close = abs(size - int(vocab)) <= int(vocab) * 0.01
    return {"pass": close and round_trip, "vocab": size, "roundTrip": round_trip, "tokens": len(ids)}


def label_index(predicted, names):
    """a pipeline label as a dataset class index, by name or LABEL_<n>"""
    lowered = [n.lower() for n in names]
    if predicted.lower() in lowered:
        return lowered.index(predicted.lower())
    found = re.fullmatch(r"(?:label_)?(\d+)", predicted.lower())
    return int(found.group(1)) if found else None


def classifier(repo, dataset, split, n):
    from datasets import load_dataset
    from transformers import pipeline

    rows = load_dataset(dataset, split=split).shuffle(seed=0).select(range(int(n)))
    names = rows.features["label"].names
    classify = pipeline("text-classification", model=repo, truncation=True)
    predictions = classify([r["text"] for r in rows], batch_size=8)
    correct = sum(label_index(p["label"], names) == r["label"] for p, r in zip(predictions, rows))
    accuracy = correct / len(rows)
    return {"pass": accuracy >= 0.5, "accuracy": accuracy, "correct": correct, "total": len(rows)}


def sentiment(result):
    """1 positive, 0 negative, None when the output names neither"""
    text = json.dumps(result).lower() if not isinstance(result, str) else result.lower()
    if isinstance(result, dict) and "label" in result:
        text = str(result["label"]).lower()
    positive = re.search(r"\bpos(itive)?\b|label_1\b", text)
    negative = re.search(r"\bneg(ative)?\b|label_0\b", text)
    if positive and not negative:
        return 1
    if negative and not positive:
        return 0
    return None


def space_sentiment(space, n):
    from datasets import load_dataset
    from gradio_client import Client

    rows = load_dataset("stanfordnlp/imdb", split="test").shuffle(seed=0).select(range(int(n)))
    client = Client(space)
    endpoint = next(iter(client.view_api(print_info=False, return_format="dict")["named_endpoints"]))
    correct = 0
    for r in rows:
        if sentiment(client.predict(r["text"][:2000], api_name=endpoint)) == r["label"]:
            correct += 1
    total = len(rows)
    return {"pass": correct >= round(total * 0.8), "correct": correct, "total": total, "endpoint": endpoint}


CHECKS = {
    "generates": generates,
    "tokenizer": tokenizer,
    "classifier": classifier,
    "space-sentiment": space_sentiment,
}


def main():
    name, *args = sys.argv[1:]
    random.seed(0)
    try:
        result = CHECKS[name](*args)
    except Exception as err:
        traceback.print_exc()
        result = {"pass": False, "error": f"{type(err).__name__}: {err}"[:500]}
    print("RESULT " + json.dumps(result), flush=True)


if __name__ == "__main__":
    main()
