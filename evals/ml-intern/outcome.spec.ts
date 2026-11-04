import { describe, expect, it } from "vitest";
import {
	artifactReady,
	askedFirst,
	fill,
	isGpuJob,
	parseHiddenResult,
	runNames,
	type RecordedUpdate,
} from "./outcome.ts";
import { SCENARIOS } from "./scenarios.ts";

const call = (
	t: number,
	name: string,
	parameters: Record<string, unknown> = {}
): RecordedUpdate => ({
	t,
	update: { type: "tool", subtype: "call", call: { name, parameters } },
});
const gpuJob = (t: number) =>
	call(t, "hf_jobs", { operation: "uv", args: { flavor: "a10g-small", script: "train.py" } });

describe("runNames", () => {
	it("gives every task, run and repeat its own repo and Space", () => {
		const names = runNames("bot", "imdb-three-artifacts", "ab12cd", 2);
		expect(names).toEqual({
			repo: "bot/ml-eval-imdb-three-artifacts-ab12cd-r2",
			space: "bot/ml-eval-imdb-three-artifacts-ab12cd-r2-demo",
		});
		expect(fill("push to {repo}, demo at {space}", names)).toBe(
			`push to ${names.repo}, demo at ${names.space}`
		);
	});

	it("keeps every repo name within the Hub's 96 characters", () => {
		for (const s of SCENARIOS) {
			const { space } = runNames("a-36-character-long-username-example", s.name, "ab12cd", 9);
			expect(space.split("/")[1].length).toBeLessThanOrEqual(96);
		}
	});
});

describe("isGpuJob", () => {
	it("reads the flavor of a run or uv submission, cpu-basic when absent", () => {
		expect(isGpuJob(gpuJob(0).update.call as never)).toBe(true);
		expect(isGpuJob({ name: "hf_jobs", parameters: { operation: "uv", args: {} } })).toBe(false);
		expect(
			isGpuJob({
				name: "hf_jobs",
				parameters: { operation: "logs", args: { flavor: "a100-large" } },
			})
		).toBe(false);
		expect(isGpuJob({ name: "hf_sandbox", parameters: { args: { flavor: "a10g-small" } } })).toBe(
			false
		);
	});
});

describe("askedFirst", () => {
	it("counts a question asked before the first GPU job", () => {
		expect(askedFirst([call(1, "ask_user_question"), gpuJob(2)], undefined)).toBe(true);
	});

	it("does not count a question asked after launching", () => {
		expect(askedFirst([gpuJob(1), call(2, "ask_user_question")], undefined)).toBe(false);
	});

	it("counts a first turn that ended without launching, which the runner nudged", () => {
		expect(askedFirst([gpuJob(10)], 5)).toBe(true);
	});

	it("does not count a run that never stopped for the user", () => {
		expect(askedFirst([call(1, "hf_sandbox"), gpuJob(2)], undefined)).toBe(false);
	});
});

describe("artifactReady", () => {
	it("wants weights for a model, full or adapter", () => {
		expect(artifactReady("model", { siblings: [{ rfilename: "README.md" }] })).toBe(false);
		expect(artifactReady("model", { siblings: [{ rfilename: "model.safetensors" }] })).toBe(true);
		expect(
			artifactReady("model", { siblings: [{ rfilename: "model-00001-of-00002.safetensors" }] })
		).toBe(true);
		expect(artifactReady("model", { siblings: [{ rfilename: "adapter_model.safetensors" }] })).toBe(
			true
		);
	});

	it("wants tokenizer.json for a tokenizer and a running Space for a Space", () => {
		expect(artifactReady("tokenizer", { siblings: [{ rfilename: "tokenizer.json" }] })).toBe(true);
		expect(artifactReady("space", { runtime: { stage: "BUILDING" } })).toBe(false);
		expect(artifactReady("space", { runtime: { stage: "RUNNING" } })).toBe(true);
	});
});

describe("parseHiddenResult", () => {
	it("reads the last RESULT line among job logs", () => {
		const logs =
			'Downloading...\nRESULT {"pass": false}\nmore\nRESULT {"pass": true, "accuracy": 0.7}\n';
		expect(parseHiddenResult(logs)).toEqual({ pass: true, accuracy: 0.7 });
	});

	it("gives nothing for logs without a well-formed result", () => {
		expect(parseHiddenResult("Traceback ...")).toBeUndefined();
		expect(parseHiddenResult("RESULT {not json")).toBeUndefined();
		expect(parseHiddenResult('RESULT {"accuracy": 1}')).toBeUndefined();
	});
});
