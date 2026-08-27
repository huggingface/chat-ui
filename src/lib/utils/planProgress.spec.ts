import { describe, it, expect } from "vitest";
import { planStepsToMlSteps } from "./planProgress";
import type { PlanStep } from "$lib/types/Plan";

describe("planStepsToMlSteps", () => {
	it("maps every plan status onto the strip's lifecycle", () => {
		const steps: PlanStep[] = [
			{ step: "Baseline eval", status: "completed" },
			{ step: "Finetune", status: "in_progress" },
			{ step: "Compare runs", status: "pending" },
			{ step: "Sweep seeds", status: "skipped" },
		];
		expect(planStepsToMlSteps(steps).map((s) => s.status)).toEqual([
			"done",
			"running",
			"pending",
			"skipped",
		]);
	});

	it("keeps the full step text as the tooltip description", () => {
		const [mapped] = planStepsToMlSteps([
			{ step: "Design the social companion: pick platforms and handles", status: "pending" },
		]);
		expect(mapped.description).toBe("Design the social companion: pick platforms and handles");
	});

	it("cuts a short label from long step text and marks the cut", () => {
		const [mapped] = planStepsToMlSteps([
			{ step: "Design the social companion: pick platforms and handles", status: "pending" },
		]);
		expect(mapped.label.length).toBeLessThanOrEqual(25);
		expect(mapped.label.endsWith("…")).toBe(true);
	});

	it("leaves a step that already fits untouched", () => {
		const [mapped] = planStepsToMlSteps([{ step: "Baseline eval", status: "pending" }]);
		expect(mapped.label).toBe("Baseline eval");
		expect(mapped.statusLabel).toBe("Baseline eval");
	});

	it("prefers the model-authored label over any cut of the step text", () => {
		const [mapped] = planStepsToMlSteps([
			{
				step: "Design the social companion: pick platforms and handles",
				label: "Social design",
				status: "in_progress",
			},
		]);
		expect(mapped.label).toBe("Social design");
		expect(mapped.statusLabel).toBe("Social design");
		expect(mapped.description).toBe("Design the social companion: pick platforms and handles");
	});
});
