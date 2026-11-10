import { describe, expect, it } from "vitest";
import { compareArms, markdown, MEASURES, pairedCases, type Arm, type ArmRun } from "./report.ts";

const run = (name: string, repeat: number, failed: number, hidden?: boolean): ArmRun => ({
	name,
	repeat,
	passed: hidden === true,
	timeoutMinutes: 60,
	artifacts: ["model"],
	outcome: {
		costUsd: 1,
		durationSec: 600,
		artifactMinutes: { model: hidden ? 20 : null },
		hidden: hidden === undefined ? undefined : { pass: hidden },
		metrics: {
			jobs: failed + 1,
			gpu_jobs: 1,
			failed,
			completed: 1,
			longest_failed_streak: failed,
			failed_before_first_success: failed,
			jobs_to_first_success: failed + 1,
			sandbox_creates: 0,
			gpu_sandbox_creates: 0,
			sandbox_before_first_gpu_job: 0,
			sandbox_on_flavor_before_first_gpu_job: "",
			after_failure_sandbox: 0,
			after_failure_resubmit: failed,
			after_failure_stopped: 0,
			sandbox_first_refusals: 0,
			minutes_to_first_artifact: "",
		},
	},
});

const arm = (sha: string, runs: ArmRun[]): Arm => ({ sha, scenarios: runs });
const tasks = ["t1", "t2", "t3", "t4", "t5", "t6", "t7"];
const measure = (key: string) => MEASURES.find((m) => m.key === key) as (typeof MEASURES)[number];

describe("pairedCases", () => {
	it("pairs each task's repeats and drops what one arm never measured", () => {
		const a = arm("a", [run("t1", 0, 2), run("t1", 1, 3), run("t2", 0, 1)]);
		const b = arm("b", [run("t1", 0, 0), { name: "t2", repeat: 0 }]);
		expect(pairedCases(a, b, measure("failed"))).toEqual([
			{ conversationId: "t1", a: [2, 3], b: [0] },
		]);
	});

	it("leaves out a measure that does not apply, like the same-flavor sandbox with no GPU job", () => {
		const a = arm("a", [run("t1", 0, 1)]);
		expect(pairedCases(a, a, measure("sandboxOnFlavor"))).toEqual([]);
	});

	it("times a missing artifact at the task's timeout", () => {
		const a = arm("a", [run("t1", 0, 0, false)]);
		const b = arm("b", [run("t1", 0, 0, true)]);
		expect(pairedCases(a, b, measure("minutesToArtifacts"))).toEqual([
			{ conversationId: "t1", a: [60], b: [20] },
		]);
	});
});

describe("answersFallenBack", () => {
	it("shares lettered answers that fell back, ignoring ones the model never scored", () => {
		const scored = { temperature: 6.39 };
		const withAnswers = (sources: Array<"model" | "fallback">): ArmRun => ({
			...run("t1", 0, 0),
			answers: [
				{
					fields: [
						...sources.map((source) => ({ name: "q", value: "a", source, ...scored })),
						{
							name: "only",
							value: "a",
							source: "fallback" as const,
							reason: "one option" as const,
						},
					],
				},
			],
		});
		const m = measure("answersFallenBack");
		expect(m.value(withAnswers(["model", "fallback", "model", "model"]))).toBe(0.25);
		expect(m.value(run("t1", 0, 0))).toBeUndefined();
		const rows = compareArms(
			arm("a", [withAnswers(["model"])]),
			arm("b", [withAnswers(["fallback"])])
		);
		expect(rows.find((r) => r.key === "answersFallenBack")).toMatchObject({ kind: "share" });
	});
});

describe("compareArms", () => {
	it("counts a crashed run as a failed one", () => {
		const a = arm("a", [run("t1", 0, 0, true)]);
		const b = arm("b", [{ name: "t1", repeat: 0, passed: false }]);
		expect(pairedCases(a, b, measure("passed"))).toEqual([
			{ conversationId: "t1", a: [true], b: [false] },
		]);
	});

	it("finds no direction between identical arms", () => {
		const runs = tasks.flatMap((t) => [
			run(t, 0, 2, true),
			run(t, 1, 1, false),
			run(t, 2, 3, true),
		]);
		const rows = compareArms(arm("a", runs), arm("b", runs));
		expect(rows.every((r) => r.direction === null)).toBe(true);
		expect(rows.find((r) => r.key === "failed")?.diff.value).toBe(0);
	});

	it("calls far fewer failed jobs and more passed checks better, after the Holm correction", () => {
		const a = arm(
			"a",
			tasks.flatMap((t) => [0, 1, 2].map((i) => run(t, i, 4, false)))
		);
		const b = arm(
			"b",
			tasks.flatMap((t) => [0, 1, 2].map((i) => run(t, i, 0, true)))
		);
		const rows = compareArms(a, b);
		expect(rows.find((r) => r.key === "failed")?.direction).toBe("better");
		expect(rows.find((r) => r.key === "hidden")?.direction).toBe("better");
		expect(rows.find((r) => r.key === "jobs")?.pHolm).toBeNull();
		expect(markdown(a, b, rows)).toContain("## ML Intern outcome eval: better on");
	});

	it("calls the reverse worse", () => {
		const a = arm(
			"a",
			tasks.flatMap((t) => [0, 1, 2].map((i) => run(t, i, 0, true)))
		);
		const b = arm(
			"b",
			tasks.flatMap((t) => [0, 1, 2].map((i) => run(t, i, 4, false)))
		);
		const rows = compareArms(a, b);
		expect(rows.find((r) => r.key === "failed")?.direction).toBe("worse");
		expect(markdown(a, b, rows)).toContain("worse on");
	});
});
