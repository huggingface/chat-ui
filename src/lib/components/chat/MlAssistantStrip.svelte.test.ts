import MlAssistantStrip from "./MlAssistantStrip.svelte";
import { render } from "vitest-browser-svelte";
import { describe, expect, it, vi } from "vitest";
import type { MlPlanStep } from "$lib/types/MlAssistant";

/**
 * The design handoff pins exact colours, sizes and timings, so these assert
 * computed style rather than class names.
 */

// The mode's fills (running dot) and its text run two different oranges:
// vibrant for surfaces, darker for legible text on the pale band.
const ACCENT = "rgb(234, 88, 12)";
const ACCENT_TEXT = "rgb(194, 65, 12)";
const SUCCESS = "rgb(22, 163, 74)";

const step = (
	label: string,
	status: MlPlanStep["status"],
	statusLabel = `${label}ing`
): MlPlanStep => ({ label, statusLabel, description: `${label} description`, status });

const PLAN: MlPlanStep[] = [
	step("Research", "done", "Researching"),
	step("Baseline eval", "skipped", "Skipped"),
	step("Training", "running", "Training"),
	step("Deploy", "pending", "Deploying"),
];

function mount(props: Partial<Parameters<typeof render<typeof MlAssistantStrip>>[1]> = {}) {
	return render(MlAssistantStrip, {
		visible: true,
		steps: [],
		statusLabel: "",
		complete: false,
		...props,
	});
}

const find = (root: ParentNode, selector: string): HTMLElement => {
	const el = root.querySelector<HTMLElement>(selector);
	if (!el) throw new Error(`no element matching ${selector}`);
	return el;
};
const style = (el: Element) => getComputedStyle(el);
const box = (el: Element) => {
	const r = el.getBoundingClientRect();
	return { width: Math.round(r.width), height: Math.round(r.height) };
};

describe("MlAssistantStrip", () => {
	it("renders the band with the preset tool list and accent tint", () => {
		const { container } = mount();
		const strip = find(container, ".ml-strip");

		expect(strip.textContent).toContain("ML Intern");
		expect(strip.textContent).toContain("papers · training · spaces · datasets · eval · hub");
		expect(container.querySelector('[role="switch"]')).toBeNull();
		expect(style(strip).backgroundColor).toBe("rgb(255, 244, 234)");
		expect(style(strip).borderBottomColor).toBe("rgb(251, 228, 204)");
		expect(style(strip).color).toBe(ACCENT_TEXT);
	});

	it("lays the strip out on the specified spacing", () => {
		const { container } = mount();
		const strip = style(find(container, ".ml-strip"));

		expect(strip.padding).toBe("9px 16px");
		expect(strip.gap).toBe("9px");
		expect(strip.fontSize).toBe("13.5px");
	});

	it("truncates the tool note rather than overflowing a narrow composer", () => {
		const { container } = mount();
		container.style.width = "375px";
		const note = find(container, ".ml-strip span.truncate");

		expect(style(note).textOverflow).toBe("ellipsis");
		expect(note.scrollWidth).toBeGreaterThan(note.clientWidth);
		expect(note.getBoundingClientRect().right).toBeLessThanOrEqual(
			Math.ceil(find(container, ".ml-strip").getBoundingClientRect().right)
		);
	});

	it("collapses out of the composer when hidden", () => {
		const shown = style(find(mount().container, ".ml-strip-collapse"));
		expect(shown.maxHeight).toBe("56px");
		expect(shown.opacity).toBe("1");

		const hidden = style(find(mount({ visible: false }).container, ".ml-strip-collapse"));
		expect(hidden.maxHeight).toBe("0px");
		expect(hidden.opacity).toBe("0");
	});

	it("keeps the tool note until the run reports a plan", () => {
		const { container } = mount({ steps: [] });

		expect(container.textContent).toContain("papers · training · spaces · datasets · eval · hub");
		expect(container.querySelector(".ml-dot")).toBeNull();
	});

	it("renders one dot per plan step, styled by status", () => {
		const { container } = mount({ steps: PLAN, statusLabel: "Training" });
		const dots = [...container.querySelectorAll(".ml-dot")];
		// Settled steps trade their number for an icon: a tick when done, a slash
		// when skipped. Unsettled steps keep their number.
		expect(dots.map((d) => d.textContent?.trim())).toEqual(["", "", "3", "4"]);
		expect(dots[0].querySelector("svg")).not.toBeNull();
		expect(dots[1].querySelector("svg")).not.toBeNull();
		expect(dots[2].querySelector("svg")).toBeNull();
		expect(box(dots[0])).toEqual({ width: 22, height: 22 });

		const [done, skipped, running, pending] = dots.map(style);
		expect(done.backgroundColor).toBe(SUCCESS);
		// Washed out via pre-blended solids, not element opacity, so the connector
		// line cannot show through a translucent dot.
		expect(skipped.backgroundColor).toBe("rgb(244, 240, 239)");
		expect(skipped.opacity).toBe("1");
		expect(running.backgroundColor).toBe(ACCENT);
		expect(running.animationName).toContain("mlpulse");
		expect(pending.backgroundColor).toBe("rgb(255, 255, 255)");
		expect(pending.borderTopColor).toBe("rgb(220, 220, 226)");
	});

	it("keeps the dots tappable without disturbing the row's 10px rhythm", () => {
		const { container } = mount({ steps: PLAN, statusLabel: "Training" });
		const hits = [...container.querySelectorAll(".ml-dot-hit")];
		expect(box(hits[0])).toEqual({ width: 27, height: 44 });

		const dots = [...container.querySelectorAll(".ml-dot")];
		const gap = dots[1].getBoundingClientRect().left - dots[0].getBoundingClientRect().right;
		expect(Math.round(gap)).toBe(10);
	});

	it("names each dot by its step and status", () => {
		const { container } = mount({ steps: PLAN, statusLabel: "Training" });

		expect(
			[...container.querySelectorAll(".ml-dot-hit")].map((b) => b.getAttribute("aria-label"))
		).toEqual([
			"Research — done",
			"Baseline eval — skipped",
			"Training — running",
			"Deploy — pending",
		]);
	});

	it("announces the running step, and turns the label green when the plan is done", () => {
		const running = find(
			mount({ steps: PLAN, statusLabel: "Training" }).container,
			'[aria-live="polite"]'
		);
		expect(running.textContent?.trim()).toBe("Training");
		expect(style(running).color).toBe(ACCENT_TEXT);

		const done = find(
			mount({
				steps: PLAN.map((s) => ({ ...s, status: "done" as const })),
				statusLabel: "Done",
				complete: true,
			}).container,
			'[aria-live="polite"]'
		);
		expect(done.textContent?.trim()).toBe("Done");
		expect(style(done).color).toBe(SUCCESS);
	});

	it("announces the mode to screen readers despite carrying no control", () => {
		const { container } = mount({ steps: PLAN, statusLabel: "Training" });

		expect(container.textContent).toContain("ML Intern, mode on");
	});

	it("reaches a step's description by keyboard focus, not hover alone", async () => {
		const { container } = mount({ steps: PLAN, statusLabel: "Training" });
		(container.querySelector(".ml-dot-hit") as HTMLElement).focus();

		await vi.waitFor(() => {
			expect(find(document, ".ml-dot-tooltip").textContent).toContain("Research description");
		});
	});

	it("shows a step's description on hover, escaping the composer's overflow", async () => {
		const { container } = mount({ steps: PLAN, statusLabel: "Training" });
		const trigger = find(container, ".ml-dot-hit");
		trigger.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
		trigger.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));

		await vi.waitFor(() => {
			const tip = find(document, ".ml-dot-tooltip");
			expect(tip.textContent).toContain("Research");
			expect(tip.textContent).toContain("Research description");
			// Portalled out of the strip, which is clipped by the composer box.
			expect(find(container, ".ml-strip").contains(tip)).toBe(false);
			expect(style(tip).backgroundColor).toBe("rgb(26, 26, 31)");
		});
	});
});

describe("MlAssistantStrip budget", () => {
	const BUDGET = {
		totalMicroUsd: 10_000_000,
		spentMicroUsd: 1_500_000,
		reservedMicroUsd: 1_000_000,
	};

	it("shows the remaining balance when the conversation carries a budget", () => {
		const { container } = mount({ budget: BUDGET });
		const readout = find(container, "button[aria-label^='Session budget']");
		expect(readout.textContent).toContain("$7.50 left");
	});

	it("shows no readout without a budget", () => {
		const { container } = mount();
		expect(container.querySelector("button[aria-label^='Session budget']")).toBeNull();
	});

	it("commits an edited total on Enter", async () => {
		const onbudgetchange = vi.fn();
		const { container } = mount({ budget: BUDGET, onbudgetchange });

		find(container, "button[aria-label^='Session budget']").click();
		await Promise.resolve();
		const input = find(container, "input[aria-label^='Session budget']") as HTMLInputElement;
		input.value = "25";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		await Promise.resolve();

		expect(onbudgetchange).toHaveBeenCalledWith(25);
		// The editor closes back to the readout.
		expect(container.querySelector("input[aria-label^='Session budget']")).toBeNull();
	});

	it("abandons the edit on Escape", async () => {
		const onbudgetchange = vi.fn();
		const { container } = mount({ budget: BUDGET, onbudgetchange });

		find(container, "button[aria-label^='Session budget']").click();
		await Promise.resolve();
		const input = find(container, "input[aria-label^='Session budget']") as HTMLInputElement;
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		await Promise.resolve();

		expect(onbudgetchange).not.toHaveBeenCalled();
	});

	it("stays a static readout when no change handler is given", async () => {
		const { container } = mount({ budget: BUDGET });
		find(container, "button[aria-label^='Session budget']").click();
		await Promise.resolve();
		expect(container.querySelector("input[aria-label^='Session budget']")).toBeNull();
	});
});
