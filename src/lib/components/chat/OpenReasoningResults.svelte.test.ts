import OpenReasoningResults from "./OpenReasoningResults.svelte";
import { render } from "vitest-browser-svelte";
import { page } from "@vitest/browser/context";

import { describe, expect, it } from "vitest";

const LONG_REASONING = Array.from(
	{ length: 20 },
	(_, i) => `Paragraph ${i + 1}: thinking about something here that goes on for a bit.`
).join("\n\n");

describe("OpenReasoningResults", () => {
	it("renders the streaming viewport when loading", async () => {
		const { baseElement } = render(OpenReasoningResults, {
			content: LONG_REASONING,
			loading: true,
		});

		const viewport = baseElement.querySelector(".thinking-viewport") as HTMLElement | null;
		if (!viewport) throw new Error("expected .thinking-viewport to be rendered");
		// Scoped <style> block applies the gradient fade mask
		const style = getComputedStyle(viewport);
		const hasMask =
			style.maskImage?.includes("linear-gradient") ||
			(style as unknown as { webkitMaskImage?: string }).webkitMaskImage?.includes(
				"linear-gradient"
			);
		expect(hasMask).toBe(true);

		// Full content is in the DOM (CSS clipping handles the visual cropping)
		expect(page.getByText("Paragraph 20:", { exact: false })).toBeInTheDocument();
		expect(page.getByText("Paragraph 1:", { exact: false })).toBeInTheDocument();
	});

	it("collapses in the capped streaming shape at answer-start (no expand bounce)", async () => {
		const { container, rerender } = render(OpenReasoningResults, {
			content: LONG_REASONING,
			loading: true,
		});
		await new Promise((r) => setTimeout(r, 100));
		const initial = container.getBoundingClientRect().height;
		expect(container.querySelector(".thinking-viewport")).not.toBeNull();

		// Answer starts: loading flips false and the auto-collapse slides out.
		// The OUTGOING content must keep the capped .thinking-viewport shape for
		// the whole slide — if the uncapped settled prose mounts first (isOpen
		// still true for one render), a long thought bounces to its full height
		// before collapsing. The settled prose is any .prose OUTSIDE the capped
		// viewport; the box must also never grow past its streaming height.
		await rerender({ loading: false });
		let sawSettledProse = false;
		let maxHeight = 0;
		for (let i = 0; i < 30; i++) {
			await new Promise((r) => requestAnimationFrame(r));
			maxHeight = Math.max(maxHeight, container.getBoundingClientRect().height);
			sawSettledProse ||= [...container.querySelectorAll(".prose")].some(
				(p) => !p.closest(".thinking-viewport")
			);
		}
		expect(sawSettledProse).toBe(false);
		expect(maxHeight).toBeLessThanOrEqual(initial + 8);
		// The slide finished: streaming viewport unmounted, header-row height.
		expect(container.querySelector(".thinking-viewport")).toBeNull();
		expect(container.getBoundingClientRect().height).toBeLessThan(initial / 2);
	});

	it("renders the full text view when not loading", async () => {
		const { baseElement } = render(OpenReasoningResults, {
			content: LONG_REASONING,
			loading: false,
		});

		// After streaming, default state is collapsed; expand it
		const toggle = baseElement.querySelector("button");
		if (!toggle) throw new Error("expected toggle button to be rendered");
		toggle.click();

		// No streaming viewport when not loading
		await new Promise((r) => setTimeout(r, 0));
		expect(baseElement.querySelector(".thinking-viewport")).toBeNull();
	});
});
