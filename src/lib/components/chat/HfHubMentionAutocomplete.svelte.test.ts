import HfHubMentionAutocomplete from "./HfHubMentionAutocomplete.svelte";
import { render } from "vitest-browser-svelte";
import { describe, expect, it, vi } from "vitest";

const results = [
	{ id: "distilbert/distilbert-base-uncased", type: "model" as const },
	{ id: "sentence-transformers/msmarco-distilbert", type: "dataset" as const },
	{ id: "docs-demos/distilbert-base-uncased", type: "space" as const, emoji: "🌍" },
];

const common = {
	activeIndex: 0,
	caretAnchor: { left: 24, bottom: 40 },
	onselect: () => {},
	onactivechange: () => {},
};

describe("HfHubMentionAutocomplete", () => {
	it("groups supported Hub resources and marks the keyboard selection", () => {
		const { container } = render(HfHubMentionAutocomplete, {
			...common,
			results,
			status: "success",
			activeIndex: 1,
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
			...common,
			results,
			status: "success",
			onselect,
		});

		container.querySelectorAll<HTMLButtonElement>('[role="option"]')[2].click();
		expect(onselect).toHaveBeenCalledWith(results[2]);
	});

	it("keeps the repo-type headings, one per populated group", () => {
		const { container } = render(HfHubMentionAutocomplete, {
			...common,
			results,
			status: "success",
		});

		const headers = container.querySelectorAll<HTMLElement>("[data-resource-header]");
		expect(headers).toHaveLength(3);
		expect([...headers].map((header) => header.dataset.resourceHeader)).toEqual([
			"model",
			"dataset",
			"space",
		]);
		// A group with no results contributes no heading and no empty section.
		const modelsOnly = render(HfHubMentionAutocomplete, {
			...common,
			results: [results[0]],
			status: "success",
		}).container;
		expect(modelsOnly.querySelectorAll("[data-resource-header]")).toHaveLength(1);
	});

	it("only shows a real Space emoji, and falls back to a type icon", () => {
		const { container } = render(HfHubMentionAutocomplete, {
			...common,
			results,
			status: "success",
		});

		expect(container.querySelectorAll(".hf-hub-space-emoji")).toHaveLength(1);
		expect(container.querySelector('[data-resource-type="model"] .hf-hub-space-emoji')).toBeNull();
		expect(
			container.querySelector('[data-resource-type="dataset"] .hf-hub-space-emoji')
		).toBeNull();
		// An emoji-less Space still gets an icon rather than an empty gutter.
		const noEmoji = render(HfHubMentionAutocomplete, {
			...common,
			results: [{ id: "org/space", type: "space" as const }],
			status: "success",
		}).container;
		expect(noEmoji.querySelector('[role="option"] svg')).not.toBeNull();
	});

	it("anchors the panel to the caret rather than the composer edges", () => {
		// Pete's review: it should read as an autocomplete for the word being
		// typed, so the position comes from the mention, not from the input box.
		const { container } = render(HfHubMentionAutocomplete, {
			...common,
			results,
			status: "success",
			caretAnchor: { left: 128, bottom: 56 },
		});

		const positioned = container.querySelector<HTMLElement>(".absolute");
		expect(positioned?.style.left).toBe("128px");
		expect(positioned?.style.bottom).toBe("56px");
	});

	it("exposes each category as a group so the listbox owns only options", () => {
		// A listbox may own options and groups; the headings used to be direct
		// children, which makes screen readers miscount positions.
		const { container } = render(HfHubMentionAutocomplete, {
			...common,
			results,
			status: "success",
		});

		const listbox = container.querySelector('[role="listbox"]');
		expect(listbox?.querySelector('[role="status"]')).toBeNull();
		const groups = container.querySelectorAll('[role="group"]');
		expect(groups).toHaveLength(3);
		expect(groups[0].getAttribute("aria-label")).toBe("Models");
		for (const child of listbox?.children ?? []) {
			expect(child.getAttribute("role")).toBe("group");
		}
	});

	it("shows useful loading, empty, and error states", () => {
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
		expect(empty.textContent).toContain("No match");
		expect(error.textContent).toContain("unavailable");
		// The live region announces state changes from outside the listbox.
		expect(loading.querySelector('[role="status"][aria-live="polite"]')).not.toBeNull();
	});
});
