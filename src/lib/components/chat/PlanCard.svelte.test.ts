import PlanCard from "./PlanCard.svelte";
import { render } from "vitest-browser-svelte";
import { describe, expect, it, vi } from "vitest";
import { MessageUpdateType, type MessagePlanUpdate } from "$lib/types/MessageUpdate";
import type { PlanStep } from "$lib/types/Plan";

const steps: PlanStep[] = [
	{ step: "Read the existing types", status: "completed" },
	{ step: "Write the component", status: "completed" },
	{ step: "Integrate into ChatMessage", status: "in_progress" },
	{ step: "Manual QA pass", status: "skipped" },
	{ step: "Write the browser tests", status: "pending" },
];

const plan = (over: Partial<MessagePlanUpdate> = {}): MessagePlanUpdate => ({
	type: MessageUpdateType.Plan,
	uuid: "22222222-2222-4222-8222-222222222222",
	goal: "Ship the plan card end to end",
	steps,
	version: 3,
	...over,
});

const mount = (update: MessagePlanUpdate = plan()) => render(PlanCard, { update });

const header = (el: HTMLElement) =>
	[...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Plan"));

const stepLi = (el: HTMLElement, status: PlanStep["status"]) =>
	el.querySelector<HTMLLIElement>(`li[data-status="${status}"]`);

describe("the plan card", () => {
	it("renders the goal, every step, and the progress fraction", () => {
		const { baseElement } = mount();
		expect(baseElement.textContent).toContain("Ship the plan card end to end");
		for (const { step } of steps) {
			expect(baseElement.textContent).toContain(step);
		}
		// 2 of the 5 steps are completed.
		expect(baseElement.textContent).toContain("2/5");
	});

	it("tells the step states apart at a glance", () => {
		const { baseElement } = mount();

		// Skipped reads as crossed out and muted.
		const skipped = stepLi(baseElement, "skipped");
		expect(skipped?.classList.contains("line-through")).toBe(true);

		// Completed keeps its text but gains a check icon; nothing crosses it out.
		const completed = stepLi(baseElement, "completed");
		expect(completed?.classList.contains("line-through")).toBe(false);
		expect(completed?.querySelector("svg")).not.toBeNull();

		// The current step is the emphasized one.
		const current = stepLi(baseElement, "in_progress");
		expect(current?.classList.contains("font-medium")).toBe(true);
		expect(stepLi(baseElement, "pending")?.classList.contains("font-medium")).toBe(false);

		// Each state carries its own icon, so no two rows look alike.
		expect(completed?.querySelector("svg")?.innerHTML).not.toBe(
			current?.querySelector("svg")?.innerHTML
		);
	});

	it("shows the explanation in the header when the update carries one", () => {
		const { baseElement } = mount(plan({ explanation: "Reordered after the API change" }));
		expect(baseElement.textContent).toContain("Reordered after the API change");
	});

	it("shows no explanation note when the update has none", () => {
		const { baseElement } = mount();
		expect(baseElement.textContent).not.toContain("Reordered after the API change");
		// Header holds exactly the label and the fraction.
		expect((header(baseElement)?.textContent ?? "").replace(/\s+/g, " ").trim()).toBe("Plan 2/5");
	});

	it("collapses to just the header and expands back", async () => {
		const { baseElement } = mount();
		expect(baseElement.querySelector("ol")).not.toBeNull();

		header(baseElement)?.click();
		await vi.waitFor(() => expect(baseElement.querySelector("ol")).toBeNull());

		// The header survives the collapse.
		expect(baseElement.textContent).toContain("Plan");
		expect(baseElement.textContent).toContain("2/5");
		expect(baseElement.textContent).not.toContain("Ship the plan card end to end");

		header(baseElement)?.click();
		await vi.waitFor(() => expect(baseElement.querySelector("ol")).not.toBeNull());
		expect(baseElement.textContent).toContain("Ship the plan card end to end");
	});
});
