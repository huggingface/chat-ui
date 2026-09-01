import MlInternPill from "./MlInternPill.svelte";
import { render } from "vitest-browser-svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mlAssistant } from "$lib/stores/mlAssistant.svelte";

// Vibrant accent, shared with the strip: switch track and NEW badge.
const ACCENT = "rgb(234, 88, 12)";

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
		localStorage.clear();
		mlAssistant.reset();
		mlAssistant.pillDismissed = false;
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
		expect(style(badge).backgroundColor).toBe(ACCENT);
		expect(style(badge).color).toBe("rgb(255, 255, 255)");
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

	it("dismisses for good, switching the mode off rather than stranding it on", () => {
		mlAssistant.toggle(true);
		const { container } = render(MlInternPill);

		find(container, '[aria-label="Hide ML Intern"]').click();

		expect(mlAssistant.pillDismissed).toBe(true);
		expect(mlAssistant.enabled).toBe(false);
		// Persisted, so the pill stays gone across sessions; the storage key is
		// namespaced by app identity like the MCP store's keys.
		const stored = Object.keys(localStorage).find((key) =>
			key.endsWith(":ml-intern:pill-dismissed")
		);
		expect(stored).toBeDefined();
		expect(localStorage.getItem(stored as string)).toBe("1");
	});
});
