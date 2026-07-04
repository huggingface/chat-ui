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
