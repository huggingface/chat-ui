"""Upload an ML Intern eval run (result.json from run.ts) to a Trackio Space.

One Trackio run per eval run, one step per scenario. Each step logs the full
agent trace (messages + one span per tool call, viewable in the dashboard's
Traces tab) plus the scalars the checks graded.

    pip install trackio
    python3 evals/ml-intern/log_traces.py eval-output/ml-intern/<stamp>/result.json --space <ns>/<name>
"""

import argparse
import json

import trackio


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("result", help="result.json written by run.ts")
    parser.add_argument("--space", required=True, help="Trackio Space id, e.g. user/chat-ui-ml-intern-evals")
    parser.add_argument("--project", default="ml-intern-evals")
    args = parser.parse_args()

    with open(args.result) as f:
        result = json.load(f)

    trackio.init(
        project=args.project,
        name=result["runName"],
        space_id=args.space,
        # Traces carry prompts, tool output and job logs.
        private=True,
        # The uploader's own CPU/GPU is noise next to the traces.
        auto_log_gpu=False,
        auto_log_cpu=False,
        config={"scenarios": [s["name"] for s in result["scenarios"]]},
    )
    for step, scenario in enumerate(result["scenarios"]):
        name = scenario["name"]
        metrics = {f"{name}/passed": int(bool(scenario.get("passed")))}
        outcome = scenario.get("outcome") or {}
        for key in ("costUsd", "durationSec", "trackioAccuracy", "reportedAccuracy"):
            if isinstance(outcome.get(key), (int, float)):
                metrics[f"{name}/{key}"] = outcome[key]
        trace = scenario.get("trace")
        if trace:
            metrics[f"{name}/trace"] = trackio.Trace(
                messages=trace["messages"], metadata=trace.get("metadata"), spans=trace.get("spans")
            )
        trackio.log(metrics, step=step)
    trackio.finish()


if __name__ == "__main__":
    main()
