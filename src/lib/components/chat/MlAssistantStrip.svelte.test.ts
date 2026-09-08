import MlAssistantStrip from "./MlAssistantStrip.svelte";
import { render } from "vitest-browser-svelte";
import { describe, expect, it, vi } from "vitest";
import type { MlPlanStep } from "$lib/types/MlAssistant";

/**
 * The design handoff pins exact colours, sizes and timings, so these assert
 * computed style rather than class names.
 */

// Orange is ink on a neutral surface: one solid for glyphs and connectors, a
// darker ink for text that has to stay legible.
const ORANGE_SOLID = "rgb(232, 98, 42)";
const ORANGE_INK = "rgb(196, 81, 26)";
const TEXT_FAINT = "rgb(120, 113, 108)";

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

const BUDGET = { totalMicroUsd: 10_000_000, spentMicroUsd: 1_500_000, reservedMicroUsd: 1_000_000 };
const DASHBOARD = { url: "https://x.hf.space", label: "x/y" };

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
const style = (el: Element, pseudo?: string) => getComputedStyle(el, pseudo);
const box = (el: Element) => {
	const r = el.getBoundingClientRect();
	return { width: Math.round(r.width), height: Math.round(r.height) };
};

describe("MlAssistantStrip", () => {
	it("carries orange as ink on a neutral surface, not as a tint", () => {
		const { container } = mount();
		const strip = find(container, ".ml-strip");

		expect(strip.textContent).toContain("ML Intern");
		expect(strip.textContent).toContain("papers · training · spaces · datasets · eval · hub");
		expect(container.querySelector('[role="switch"]')).toBeNull();
		expect(style(strip).backgroundColor).toBe("rgb(255, 255, 255)");
		expect(style(strip).borderBottomColor).toBe("rgb(236, 236, 234)");
		const label = [...container.querySelectorAll("span")].find(
			(el) => el.textContent?.trim() === "ML Intern"
		);
		expect(label && style(label).color).toBe(ORANGE_INK);
	});

	it("lays the strip out on the specified spacing", () => {
		const { container } = mount();
		const strip = style(find(container, ".ml-strip"));

		expect(strip.padding).toBe("0px 10px 0px 20px");
		expect(strip.gap).toBe("14px");
		expect(strip.height).toBe("44px");
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
		expect(shown.maxHeight).toBe("44px");
		expect(shown.opacity).toBe("1");

		const hidden = style(find(mount({ visible: false }).container, ".ml-strip-collapse"));
		expect(hidden.maxHeight).toBe("0px");
		expect(hidden.opacity).toBe("0");
	});

	it("keeps the tool note until the run reports a plan", () => {
		const { container } = mount({ steps: [] });

		expect(container.textContent).toContain("papers · training · spaces · datasets · eval · hub");
		expect(container.querySelector(".ml-step-hit")).toBeNull();
	});

	/** Container queries key off the strip's own width, so tests must set one. */
	function mountAt(width: number, props = {}) {
		const rendered = mount({ steps: PLAN, statusLabel: "Training", ...props });
		rendered.container.style.width = `${width}px`;
		return rendered;
	}

	it("draws done, skipped and to-do as 16px glyphs at full width", () => {
		const { container } = mountAt(700);
		const glyphs = [...container.querySelectorAll(".ml-step-glyph")];

		expect(glyphs).toHaveLength(4);
		expect(box(glyphs[0])).toEqual({ width: 16, height: 16 });
		expect(style(glyphs[0]).backgroundColor).toBe(ORANGE_SOLID);
		expect(glyphs[0].querySelector("svg")).not.toBeNull();
		expect(style(glyphs[1]).borderTopColor).toBe(ORANGE_SOLID);
		expect(style(glyphs[3]).borderTopColor).toBe("rgb(207, 203, 197)");
	});

	it("gives the running step a core and a breathing ring", () => {
		const { container } = mountAt(700);
		const running = find(container, ".ml-step-running");

		// The ring is a pseudo-element, so its animation is what identifies it.
		expect(style(running, "::before").animationName).toContain("ml-step-pulse");
		expect(style(running, "::before").animationDuration).toBe("1.4s");
		expect(style(running, "::before").backgroundColor).toBe(ORANGE_SOLID);
		// Core is half the slot and static.
		expect(style(running, "::after").width).toBe("8px");
		expect(style(running, "::after").animationName).toBe("none");
	});

	it("colours each connector after the step before it", () => {
		const { container } = mountAt(700);
		const connectors = [...container.querySelectorAll('[aria-hidden="true"]')].filter(
			(el) => Math.round(el.getBoundingClientRect().width) === 12
		);

		expect(connectors).toHaveLength(3);
		// After done and after skipped, both settled; after running, not.
		expect(style(connectors[0]).backgroundColor).toBe(ORANGE_SOLID);
		expect(style(connectors[1]).backgroundColor).toBe(ORANGE_SOLID);
		expect(style(connectors[2]).backgroundColor).toBe("rgb(224, 221, 216)");
	});

	it("collapses on its own width, down to the 184px floor", () => {
		// The ladder from the handoff: connectors, then the status text and the
		// Metrics label, then the dots shrink.
		const seen = (width: number) => {
			const { container } = mountAt(width, { budget: BUDGET, dashboard: DASHBOARD });
			const px = (el: Element | null) => (el ? Math.round(el.getBoundingClientRect().width) : 0);
			return {
				connectors: [...container.querySelectorAll('[aria-hidden="true"]')].filter(
					(el) => px(el) === 12
				).length,
				status: style(find(container, ".ml-status")).display,
				glyph: px(container.querySelector(".ml-step-glyph")),
				metricsLabel: [...container.querySelectorAll("span")].some(
					(el) => el.textContent === "Metrics" && style(el).display !== "none"
				),
			};
		};

		expect(seen(700)).toMatchObject({ connectors: 3, glyph: 16, metricsLabel: true });
		expect(seen(500)).toMatchObject({ connectors: 0, glyph: 16, metricsLabel: true });
		expect(seen(400)).toMatchObject({ connectors: 0, glyph: 16, metricsLabel: false });
		expect(seen(300)).toMatchObject({ connectors: 0, glyph: 8, metricsLabel: false });
		expect(seen(200)).toMatchObject({ connectors: 0, glyph: 6, metricsLabel: false });

		expect(seen(500).status).not.toBe("none");
		expect(seen(400).status).toBe("none");
	});

	it("names each step by its label and status", () => {
		const { container } = mount({ steps: PLAN });

		expect(
			[...container.querySelectorAll(".ml-step-hit")].map((b) => b.getAttribute("aria-label"))
		).toEqual([
			"Step 1, Research — done",
			"Step 2, Baseline eval — skipped",
			"Step 3, Training — running",
			"Step 4, Deploy — pending",
		]);
	});

	it("names the running step, and says Done when the plan completes", () => {
		const { container } = mount({ steps: PLAN, statusLabel: "Training" });

		// The live region is always present, even where the visible copy is not.
		expect(find(container, '[aria-live="polite"]').textContent?.trim()).toBe("Training");
		const running = find(container, ".ml-status");
		expect(running.textContent?.trim()).toBe("Training");
		expect(style(running).color).toBe(TEXT_FAINT);

		const done = find(
			mount({
				steps: PLAN.map((s) => ({ ...s, status: "done" as const })),
				complete: true,
			}).container,
			".ml-status"
		);
		expect(done.textContent?.trim()).toBe("Done");
		expect(style(done).color).toBe(ORANGE_INK);
	});

	it("keeps a live region at every width, including where the text is hidden", () => {
		// Hiding the only aria-live region is how a responsive layout stops
		// announcing exactly on the screens most likely to need it.
		const { container } = mount({ steps: PLAN, statusLabel: "Training" });
		container.style.width = "300px";

		expect(style(find(container, ".ml-status")).display).toBe("none");
		const live = find(container, '[aria-live="polite"]');
		expect(style(live).display).not.toBe("none");
		expect(live.textContent?.trim()).toBe("Training");
	});

	it("announces the mode to screen readers despite carrying no control", () => {
		const { container } = mount({ steps: PLAN });

		expect(container.textContent).toContain("ML Intern, mode on");
	});

	it("reaches a step's description by keyboard focus, not hover alone", async () => {
		const { container } = mount({ steps: PLAN });
		(container.querySelector(".ml-step-hit") as HTMLElement).focus();

		await vi.waitFor(() => {
			expect(find(document, ".ml-step-tooltip").textContent).toContain("Research description");
		});
	});

	it("shows a step's description on hover, escaping the composer's overflow", async () => {
		const { container } = mount({ steps: PLAN });
		const trigger = find(container, ".ml-step-hit");
		trigger.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
		trigger.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));

		await vi.waitFor(() => {
			const tip = find(document, ".ml-step-tooltip");
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

	it("edits in a chromeless text field rather than a number input", async () => {
		// type=number would put the UA's validation bubble and spinner arrows on a
		// pill the strip styles itself, so the field takes digits as plain text.
		const { container } = mount({ budget: BUDGET, onbudgetchange: vi.fn() });

		find(container, "button[aria-label^='Session budget']").click();
		await Promise.resolve();
		const input = find(container, "input[aria-label^='Session budget']") as HTMLInputElement;
		expect(input.type).toBe("text");

		input.value = "2a5.7.59";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		await Promise.resolve();
		// Letters dropped, and the fraction kept to one point and two places.
		expect(input.value).toBe("25.75");
	});

	it("takes the field's rejected characters back out of the field", async () => {
		// The sanitized value can equal what is already in state ("10" + "a" is
		// still "10"), and a value that does not change cannot re-render the DOM.
		const { container } = mount({ budget: BUDGET, onbudgetchange: vi.fn() });

		find(container, "button[aria-label^='Session budget']").click();
		await Promise.resolve();
		const input = find(container, "input[aria-label^='Session budget']") as HTMLInputElement;
		expect(input.value).toBe("10");

		input.value = "10a";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		await Promise.resolve();
		expect(input.value).toBe("10");
	});

	it("keeps a pasted figure's cents, and caps the cleaned figure at the widest total", async () => {
		// A maxlength attribute would have the UA cut the paste before the
		// sanitizer sees it, so the letters would cost the cents. The cap has to
		// apply to the cleaned figure instead. insertText goes through the UA's
		// own truncation, which a direct value assignment would bypass.
		const { container } = mount({ budget: BUDGET, onbudgetchange: vi.fn() });

		find(container, "button[aria-label^='Session budget']").click();
		await Promise.resolve();
		const input = find(container, "input[aria-label^='Session budget']") as HTMLInputElement;
		expect(input.inputMode).toBe("decimal");

		const paste = async (text: string) => {
			input.focus();
			input.select();
			document.execCommand("insertText", false, text);
			await Promise.resolve();
		};

		await paste("abcd12.34");
		expect(input.value).toBe("12.34");
		// "10000.00" — a five-character cap would have blocked "1000.50".
		await paste("1000.50");
		expect(input.value).toBe("1000.50");
		await paste("123456789");
		expect(input.value).toBe("12345678");
	});

	it("commits zero, which pauses spend rather than abandoning the edit", async () => {
		const onbudgetchange = vi.fn();
		const { container } = mount({ budget: BUDGET, onbudgetchange });

		find(container, "button[aria-label^='Session budget']").click();
		await Promise.resolve();
		const input = find(container, "input[aria-label^='Session budget']") as HTMLInputElement;
		input.value = "0";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		await Promise.resolve();

		expect(onbudgetchange).toHaveBeenCalledWith(0);
	});

	it("commits cents", async () => {
		const onbudgetchange = vi.fn();
		const { container } = mount({ budget: BUDGET, onbudgetchange });

		find(container, "button[aria-label^='Session budget']").click();
		await Promise.resolve();
		const input = find(container, "input[aria-label^='Session budget']") as HTMLInputElement;
		input.value = "1.50";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		await Promise.resolve();

		expect(onbudgetchange).toHaveBeenCalledWith(1.5);
	});

	it("abandons an empty or over-ceiling figure instead of committing it", async () => {
		const onbudgetchange = vi.fn();
		const { container } = mount({ budget: BUDGET, onbudgetchange });

		const type = async (value: string) => {
			find(container, "button[aria-label^='Session budget']").click();
			await Promise.resolve();
			const input = find(container, "input[aria-label^='Session budget']") as HTMLInputElement;
			input.value = value;
			input.dispatchEvent(new Event("input", { bubbles: true }));
			input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
			await Promise.resolve();
		};

		await type("");
		await type("10001");
		expect(onbudgetchange).not.toHaveBeenCalled();
	});

	it("stays a static readout when no change handler is given", async () => {
		const { container } = mount({ budget: BUDGET });
		find(container, "button[aria-label^='Session budget']").click();
		await Promise.resolve();
		expect(container.querySelector("input[aria-label^='Session budget']")).toBeNull();
	});
});
