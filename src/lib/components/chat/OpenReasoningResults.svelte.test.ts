import OpenReasoningResults from "./OpenReasoningResults.svelte";
import { render } from "vitest-browser-svelte";
import { page } from "@vitest/browser/context";

import { describe, expect, it, vi } from "vitest";

const LONG_REASONING = Array.from(
	{ length: 20 },
	(_, i) => `Paragraph ${i + 1}: thinking about something here that goes on for a bit.`
).join("\n\n");

const SHORT_REASONING = "One short thought.";

function maskOf(el: HTMLElement): string {
	const style = getComputedStyle(el);
	return (
		style.maskImage || (style as unknown as { webkitMaskImage?: string }).webkitMaskImage || "none"
	);
}

function viewportIn(root: Element): HTMLElement {
	const viewport = root.querySelector(".thinking-viewport");
	if (!viewport) throw new Error("expected .thinking-viewport to be rendered");
	return viewport as HTMLElement;
}

describe("OpenReasoningResults", () => {
	it("fades the top of the streaming viewport once content overflows", async () => {
		const { baseElement } = render(OpenReasoningResults, {
			content: LONG_REASONING,
			loading: true,
		});

		// The fade mask is applied via `.has-overflow`, which is driven by two
		// `bind:clientHeight` measurements. Those are ResizeObserver-backed, and the markdown
		// body itself upgrades asynchronously off a worker — so the class cannot be observed
		// on the first synchronous tick. Poll instead of asserting immediately.
		await vi.waitFor(() => {
			expect(maskOf(viewportIn(baseElement))).toContain("linear-gradient");
		});

		// Full content stays in the DOM; the cropping is purely visual.
		await expect.element(page.getByText("Paragraph 20:", { exact: false })).toBeInTheDocument();
		await expect.element(page.getByText("Paragraph 1:", { exact: false })).toBeInTheDocument();
	});

	it("does not fade the viewport when the content fits", async () => {
		const { baseElement } = render(OpenReasoningResults, {
			content: SHORT_REASONING,
			loading: true,
		});

		await expect.element(page.getByText("One short thought.")).toBeInTheDocument();

		// Give the same measurement cycle a chance to run, then assert it stayed unmasked —
		// without this inverse case the overflow assertion above would pass on a component
		// that masked unconditionally.
		await vi.waitFor(() => {
			expect(viewportIn(baseElement).classList.contains("has-overflow")).toBe(false);
		});
		expect(maskOf(viewportIn(baseElement))).not.toContain("linear-gradient");
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
		await expect.element(page.getByText("Paragraph 1:", { exact: false })).toBeInTheDocument();
		expect(baseElement.querySelector(".thinking-viewport")).toBeNull();
	});
});
