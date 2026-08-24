import { describe, expect, it, beforeEach } from "vitest";
import { mlAssistant } from "./mlAssistant.svelte";
import type { MlPlanStep } from "$lib/types/MlAssistant";

const step = (label: string, status: MlPlanStep["status"]): MlPlanStep => ({
	label,
	statusLabel: `${label}ing`,
	description: `${label} description`,
	status,
});

describe("mlAssistant store", () => {
	beforeEach(() => {
		mlAssistant.reset();
		mlAssistant.effortHold = null;
		mlAssistant.syncConversation(undefined);
	});

	it("toggles freely until a task starts, then locks", () => {
		mlAssistant.toggle(true);
		expect(mlAssistant.enabled).toBe(true);
		expect(mlAssistant.locked).toBe(false);

		mlAssistant.startTask();
		expect(mlAssistant.taskStarted).toBe(true);
		expect(mlAssistant.locked).toBe(true);

		mlAssistant.toggle(false);
		expect(mlAssistant.enabled).toBe(true);
	});

	it("does not start a task while the mode is off", () => {
		mlAssistant.startTask();
		expect(mlAssistant.taskStarted).toBe(false);
	});

	it("reports the running step's status label, then Done", () => {
		mlAssistant.setPlan([step("Research", "done"), step("Train", "running")]);
		expect(mlAssistant.activeStep).toBe(1);
		expect(mlAssistant.statusLabel).toBe("Training");
		expect(mlAssistant.complete).toBe(false);

		mlAssistant.setStepStatus(1, "done");
		expect(mlAssistant.activeStep).toBe(-1);
		expect(mlAssistant.complete).toBe(true);
		expect(mlAssistant.statusLabel).toBe("Done");
	});

	it("counts a plan that ends on a skipped step as complete", () => {
		mlAssistant.setPlan([step("Research", "done"), step("Baseline", "skipped")]);
		expect(mlAssistant.complete).toBe(true);
	});

	it("is not complete with no plan", () => {
		expect(mlAssistant.complete).toBe(false);
		expect(mlAssistant.statusLabel).toBe("");
	});

	it("adopts the conversation a run started from the home composer creates", () => {
		mlAssistant.toggle(true);
		mlAssistant.startTask();

		expect(mlAssistant.syncConversation("new-conversation")).toBe(false);
		expect(mlAssistant.enabled).toBe(true);
		expect(mlAssistant.taskStarted).toBe(true);
	});

	it("resets when the conversation changes", () => {
		mlAssistant.toggle(true);
		mlAssistant.startTask();
		mlAssistant.syncConversation("first");

		expect(mlAssistant.syncConversation("second")).toBe(true);
		expect(mlAssistant.enabled).toBe(false);
		expect(mlAssistant.taskStarted).toBe(false);
	});

	it("resets when leaving a conversation for the home composer", () => {
		mlAssistant.toggle(true);
		mlAssistant.startTask();
		mlAssistant.syncConversation("first");

		expect(mlAssistant.syncConversation(undefined)).toBe(true);
		expect(mlAssistant.enabled).toBe(false);
	});

	it("comes back locked on when reopening a conversation started in the mode", () => {
		mlAssistant.syncConversation("plain-conversation");
		expect(mlAssistant.enabled).toBe(false);

		expect(mlAssistant.syncConversation("ml-conversation", true)).toBe(true);
		expect(mlAssistant.enabled).toBe(true);
		expect(mlAssistant.taskStarted).toBe(true);
		expect(mlAssistant.locked).toBe(true);
	});

	it("drops the mode again when leaving that conversation for a plain one", () => {
		mlAssistant.syncConversation("ml-conversation", true);

		expect(mlAssistant.syncConversation("plain-conversation")).toBe(true);
		expect(mlAssistant.enabled).toBe(false);
		expect(mlAssistant.taskStarted).toBe(false);
	});

	it("does not adopt a conversation opened before any task started", () => {
		mlAssistant.toggle(true);

		expect(mlAssistant.syncConversation("existing")).toBe(true);
		expect(mlAssistant.enabled).toBe(false);
	});

	it("is idempotent for the same conversation", () => {
		mlAssistant.syncConversation("same");
		mlAssistant.toggle(true);

		expect(mlAssistant.syncConversation("same")).toBe(false);
		expect(mlAssistant.enabled).toBe(true);
	});

	it("round-trips the effort hold it is asked to keep", () => {
		expect(mlAssistant.effortHold).toBeNull();

		mlAssistant.effortHold = { modelId: "org/model", previous: "low" };
		expect(mlAssistant.effortHold).toEqual({ modelId: "org/model", previous: "low" });

		// Held across a conversation reset: only the composer can put the value
		// back, so `reset()` must not drop the record of what to put back.
		mlAssistant.syncConversation("elsewhere");
		expect(mlAssistant.effortHold).toEqual({ modelId: "org/model", previous: "low" });
	});

	it("ignores a status update for a step outside the plan", () => {
		mlAssistant.setPlan([step("Research", "pending")]);
		mlAssistant.setStepStatus(4, "done");
		expect(mlAssistant.steps).toHaveLength(1);
		expect(mlAssistant.steps[0].status).toBe("pending");
	});
});
