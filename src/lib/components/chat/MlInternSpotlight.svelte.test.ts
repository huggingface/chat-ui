import MlInternSpotlight from "./MlInternSpotlight.svelte";
import { renderWithApp } from "$lib/components/__tests__/renderWithApp";
import { describe, expect, it, vi } from "vitest";

const buttonNamed = (root: ParentNode, name: string): HTMLButtonElement => {
	const el = [...root.querySelectorAll("button")].find(
		(b) => b.textContent?.trim() === name || b.getAttribute("aria-label") === name
	);
	if (!el) throw new Error(`no button named ${name}`);
	return el;
};

describe("MlInternSpotlight", () => {
	it("is a labelled region carrying the launch line and the NEW badge", () => {
		const { container } = renderWithApp(MlInternSpotlight, { ontry: vi.fn(), ondismiss: vi.fn() });

		const id = container.querySelector("section")?.getAttribute("aria-labelledby") ?? "";
		expect(document.getElementById(id)?.textContent).toContain("Have an ML idea?");
		expect(container.textContent).toContain("No PhD required");
		expect(container.textContent).toContain("NEW");
	});

	it("offers exactly two actions: try the mode, or put the card away", () => {
		const ontry = vi.fn();
		const ondismiss = vi.fn();
		const { container } = renderWithApp(MlInternSpotlight, { ontry, ondismiss });

		expect(container.querySelectorAll("button").length).toBe(2);
		buttonNamed(container, "Try it").click();
		buttonNamed(container, "Dismiss").click();
		expect(ontry).toHaveBeenCalledTimes(1);
		expect(ondismiss).toHaveBeenCalledTimes(1);
	});
});
