import MlAssistantStrip from "./MlAssistantStrip.svelte";
import { render } from "vitest-browser-svelte";
import { describe, expect, it, vi } from "vitest";
import type { MlPlanStep } from "$lib/types/MlAssistant";

/**
 * The design handoff pins exact colours, sizes and timings, so these assert
 * computed style rather than class names.
 */

// The mode's fills (switch track, running dot) and its text run two different
// oranges: vibrant for surfaces, darker for legible text on the pale band.
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
		enabled: false,
		taskRunning: false,
		steps: [],
		statusLabel: "",
		complete: false,
		ontoggle: () => {},
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
	it("renders the off state with the tool note and no Configure link", () => {
		const { container } = mount();
		const strip = find(container, ".ml-strip");

		expect(strip.textContent).toContain("ML Intern");
		expect(strip.textContent).toContain(
			"— tools and prompts for papers, finetuning, demos and datasets"
		);
		expect(container.textContent).not.toContain("Configure");
		expect(style(strip).backgroundColor).toBe("rgba(0, 0, 0, 0)");
		expect(style(strip).borderBottomColor).toBe("rgb(236, 236, 238)");
	});

	it("renders the on state with the preset tool list, Configure link and accent tint", () => {
		const { container } = mount({ enabled: true });
		const strip = find(container, ".ml-strip");

		expect(strip.textContent).toContain("papers · training · spaces · datasets · eval · hub");
		expect(container.textContent).toContain("Configure");
		expect(style(strip).backgroundColor).toBe("rgb(255, 244, 234)");
		expect(style(strip).borderBottomColor).toBe("rgb(251, 228, 204)");
		expect(style(strip).color).toBe(ACCENT_TEXT);
	});

	it("lays the strip out on the specified spacing", () => {
		const { container } = mount({ enabled: true });
		const strip = style(find(container, ".ml-strip"));

		expect(strip.padding).toBe("9px 16px");
		expect(strip.gap).toBe("9px");
		expect(strip.fontSize).toBe("13.5px");
	});

	it("truncates the tool note rather than pushing Configure off a narrow composer", () => {
		const { container } = mount({ enabled: true });
		container.style.width = "375px";
		const note = find(container, ".ml-strip span.truncate");
		const configure = find(container, "button:not(.ml-switch)");

		expect(style(note).textOverflow).toBe("ellipsis");
		expect(note.scrollWidth).toBeGreaterThan(note.clientWidth);
		expect(configure.getBoundingClientRect().right).toBeLessThanOrEqual(
			Math.ceil(find(container, ".ml-strip").getBoundingClientRect().right)
		);
	});

	it("exposes the mode as a labelled switch", async () => {
		const ontoggle = vi.fn();
		const { container } = mount({ enabled: false, ontoggle });
		const control = container.querySelector(".ml-switch") as HTMLElement;

		expect(control.getAttribute("role")).toBe("switch");
		expect(control.getAttribute("aria-checked")).toBe("false");
		expect(control.getAttribute("aria-label")).toBe("ML Intern mode");
		// Visual size is 26x15, but the control itself has to stay tappable.
		expect(box(control)).toEqual({ width: 44, height: 44 });

		control.click();
		expect(ontoggle).toHaveBeenCalledWith(true);
	});

	it("moves the knob across the track when the mode is on", () => {
		const off = mount().container;
		expect(box(find(off, ".ml-switch-track"))).toEqual({ width: 26, height: 15 });
		expect(box(find(off, ".ml-switch-knob"))).toEqual({ width: 11, height: 11 });
		expect(style(find(off, ".ml-switch-knob")).left).toBe("2px");
		expect(style(find(off, ".ml-switch-track")).backgroundColor).toBe("rgb(216, 216, 221)");

		const on = mount({ enabled: true }).container;
		expect(style(find(on, ".ml-switch-knob")).left).toBe("13px");
		expect(style(find(on, ".ml-switch-track")).backgroundColor).toBe(ACCENT);
	});

	it("collapses out of the composer when hidden", () => {
		const shown = style(find(mount().container, ".ml-strip-collapse"));
		expect(shown.maxHeight).toBe("56px");
		expect(shown.opacity).toBe("1");

		const hidden = style(find(mount({ visible: false }).container, ".ml-strip-collapse"));
		expect(hidden.maxHeight).toBe("0px");
		expect(hidden.opacity).toBe("0");
	});

	it("collapses the switch and drops Configure once a task is running", () => {
		const { container } = mount({
			enabled: true,
			taskRunning: true,
			steps: PLAN,
			statusLabel: "Training",
		});
		const slot = style(find(container, ".ml-switch-slot"));

		// Zero width plus a negative margin that eats the flex gap, so the title
		// slides all the way left.
		expect(slot.width).toBe("0px");
		expect(slot.marginRight).toBe("-9px");
		expect(slot.opacity).toBe("0");
		expect(container.textContent).not.toContain("Configure");
		expect(container.textContent).not.toContain("papers · training");
	});

	it("keeps the tool note until the run reports a plan", () => {
		const { container } = mount({ enabled: true, taskRunning: true, steps: [] });

		expect(container.textContent).toContain("papers · training · spaces · datasets · eval · hub");
		expect(container.querySelector(".ml-dot")).toBeNull();
	});

	it("renders one dot per plan step, styled by status", () => {
		const { container } = mount({
			enabled: true,
			taskRunning: true,
			steps: PLAN,
			statusLabel: "Training",
		});
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
		const { container } = mount({
			enabled: true,
			taskRunning: true,
			steps: PLAN,
			statusLabel: "Training",
		});
		const hits = [...container.querySelectorAll(".ml-dot-hit")];
		expect(box(hits[0])).toEqual({ width: 27, height: 44 });

		const dots = [...container.querySelectorAll(".ml-dot")];
		const gap = dots[1].getBoundingClientRect().left - dots[0].getBoundingClientRect().right;
		expect(Math.round(gap)).toBe(10);
	});

	it("names each dot by its step and status", () => {
		const { container } = mount({
			enabled: true,
			taskRunning: true,
			steps: PLAN,
			statusLabel: "Training",
		});

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
			mount({ enabled: true, taskRunning: true, steps: PLAN, statusLabel: "Training" }).container,
			'[aria-live="polite"]'
		);
		expect(running.textContent?.trim()).toBe("Training");
		expect(style(running).color).toBe(ACCENT_TEXT);

		const done = find(
			mount({
				enabled: true,
				taskRunning: true,
				steps: PLAN.map((s) => ({ ...s, status: "done" as const })),
				statusLabel: "Done",
				complete: true,
			}).container,
			'[aria-live="polite"]'
		);
		expect(done.textContent?.trim()).toBe("Done");
		expect(style(done).color).toBe(SUCCESS);
	});

	it("keeps the mode announced after the switch collapses", () => {
		const { container } = mount({
			enabled: true,
			taskRunning: true,
			steps: PLAN,
			statusLabel: "Training",
		});

		expect(container.textContent).toContain("ML Intern, mode on");
	});

	it("reaches a step's description by keyboard focus, not hover alone", async () => {
		const { container } = mount({
			enabled: true,
			taskRunning: true,
			steps: PLAN,
			statusLabel: "Training",
		});
		(container.querySelector(".ml-dot-hit") as HTMLElement).focus();

		await vi.waitFor(() => {
			expect(find(document, ".ml-dot-tooltip").textContent).toContain("Research description");
		});
	});

	it("shows a step's description on hover, escaping the composer's overflow", async () => {
		const { container } = mount({
			enabled: true,
			taskRunning: true,
			steps: PLAN,
			statusLabel: "Training",
		});
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
