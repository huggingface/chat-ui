import HfHubMentionAutocomplete from "./HfHubMentionAutocomplete.svelte";
import { render } from "vitest-browser-svelte";
import { describe, expect, it, vi } from "vitest";

const results = [
	{ id: "distilbert/distilbert-base-uncased", type: "model" as const },
	{ id: "sentence-transformers/msmarco-distilbert", type: "dataset" as const },
	{ id: "docs-demos/distilbert-base-uncased", type: "space" as const, emoji: "🌍" },
];

describe("HfHubMentionAutocomplete", () => {
	it("groups supported Hub resources and marks the keyboard selection", () => {
		const { container } = render(HfHubMentionAutocomplete, {
			results,
			status: "success",
			activeIndex: 1,
			onselect: () => {},
			onactivechange: () => {},
		});

		expect(container.textContent).toContain("Models");
		expect(container.textContent).toContain("Datasets");
		expect(container.textContent).toContain("Spaces");
		expect(container.querySelectorAll('[role="option"]')).toHaveLength(3);
		expect(container.querySelector('[aria-selected="true"]')?.textContent).toContain(
			"sentence-transformers/msmarco-distilbert"
		);
	});

	it("returns the selected resource", () => {
		const onselect = vi.fn();
		const { container } = render(HfHubMentionAutocomplete, {
			results,
			status: "success",
			activeIndex: 0,
			onselect,
			onactivechange: () => {},
		});

		container.querySelectorAll<HTMLButtonElement>('[role="option"]')[2].click();
		expect(onselect).toHaveBeenCalledWith(results[2]);
	});

	it("uses Hub category colors and only shows real Space emoji", () => {
		const { container } = render(HfHubMentionAutocomplete, {
			results,
			status: "success",
			activeIndex: 0,
			onselect: () => {},
			onactivechange: () => {},
		});

		const headers = container.querySelectorAll<HTMLElement>("[data-resource-header]");
		expect(headers).toHaveLength(3);
		expect(headers[0].className).toContain("bg-blue-100");
		expect(headers[1].className).toContain("bg-red-100");
		expect(headers[2].className).toContain("bg-orange-100");
		expect(container.querySelectorAll(".hf-hub-space-emoji")).toHaveLength(1);
		expect(container.querySelector('[data-resource-type="model"] .hf-hub-space-emoji')).toBeNull();
		expect(
			container.querySelector('[data-resource-type="dataset"] .hf-hub-space-emoji')
		).toBeNull();
	});

	it("shows useful loading, empty, and error states", () => {
		const common = { activeIndex: 0, onselect: () => {}, onactivechange: () => {} };
		const loading = render(HfHubMentionAutocomplete, {
			...common,
			results: [],
			status: "loading",
		}).container;
		const empty = render(HfHubMentionAutocomplete, {
			...common,
			results: [],
			status: "success",
		}).container;
		const error = render(HfHubMentionAutocomplete, {
			...common,
			results: [],
			status: "error",
		}).container;

		expect(loading.textContent).toContain("Searching");
		expect(empty.textContent).toContain("No matching");
		expect(error.textContent).toContain("Couldn’t search");
	});
});
