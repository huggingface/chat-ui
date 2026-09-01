import MlInternPill from "./MlInternPill.svelte";
import { render } from "vitest-browser-svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mlAssistant } from "$lib/stores/mlAssistant.svelte";

// Vibrant accent for surfaces (switch track), darker orange for anything that
// has to carry legible white text (NEW badge) — same split as the strip.
const ACCENT = "rgb(234, 88, 12)";
const ACCENT_TEXT = "rgb(194, 65, 12)";

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

describe("MlInternPill", () => {
	beforeEach(() => {
		mlAssistant.reset();
	});

	it("exposes the mode as a labelled switch carrying the NEW badge", () => {
		const { container } = render(MlInternPill);
		const control = find(container, '[role="switch"]');

		expect(control.getAttribute("aria-checked")).toBe("false");
		expect(control.getAttribute("aria-label")).toBe("ML Intern mode");
		expect(control.textContent).toContain("ML Intern");
		expect(control.textContent).toContain("NEW");

		const badge = [...control.querySelectorAll("span")].find((s) =>
			s.textContent?.includes("NEW")
		) as HTMLElement;
		expect(style(badge).backgroundColor).toBe(ACCENT_TEXT);
		expect(style(badge).color).toBe("rgb(255, 255, 255)");
	});

	it("keeps the switch tappable across the pill's full height", () => {
		const { container } = render(MlInternPill);
		const pill = container.firstElementChild as HTMLElement;
		const control = find(container, '[role="switch"]');

		expect(box(control).height).toBe(box(pill).height);
	});

	it("draws an off switch on the specified geometry", () => {
		const { container } = render(MlInternPill);

		expect(box(find(container, ".ml-pill-track"))).toEqual({ width: 30, height: 17 });
		expect(box(find(container, ".ml-pill-knob"))).toEqual({ width: 13, height: 13 });
		expect(style(find(container, ".ml-pill-knob")).left).toBe("2px");
		expect(style(find(container, ".ml-pill-track")).backgroundColor).toBe("rgb(216, 216, 221)");
	});

	it("toggles the mode on click, retinting the pill and crossing the knob", async () => {
		const { container } = render(MlInternPill);
		find(container, '[role="switch"]').click();

		expect(mlAssistant.enabled).toBe(true);
		await vi.waitFor(() => {
			expect(find(container, '[role="switch"]').getAttribute("aria-checked")).toBe("true");
			expect(style(find(container, ".ml-pill-knob")).left).toBe("15px");
			expect(style(find(container, ".ml-pill-track")).backgroundColor).toBe(ACCENT);
		});
	});

	it("offers no dismiss control — the pill is the mode's only entry point", () => {
		const { container } = render(MlInternPill);

		expect(container.querySelectorAll("button").length).toBe(1);
		expect(find(container, "button").getAttribute("role")).toBe("switch");
	});
});
