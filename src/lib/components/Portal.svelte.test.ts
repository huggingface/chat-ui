import PortalInBlock from "./__tests__/PortalInBlock.svelte";
import { render } from "vitest-browser-svelte";
import { describe, expect, it, vi } from "vitest";

const inBody = (label: string) => document.body.querySelector(`[data-portal="${label}"]`);

/** The Modal backdrop fades out for 300ms before its block is torn down. */
const gone = (label: string) =>
	vi.waitFor(() => expect(inBody(label)).toBeNull(), { timeout: 2000 });

describe("Portal", () => {
	it("moves its content into document.body and removes it on teardown", async () => {
		const a = render(PortalInBlock, { label: "a" });
		const content = inBody("a");
		expect(content).not.toBeNull();
		expect(a.container.contains(content)).toBe(false);
		await a.rerender({ show: false });
		await gone("a");
	});

	it("leaves the node Svelte owns where it was rendered", () => {
		// Regression. The node moved into body used to be the portal's own root.
		// For a server-rendered dialog (the welcome modal on a first visit) that
		// root is the start of the hydrated block's DOM range while the range's
		// end anchor stays in the original tree, so tearing the block down walked
		// body from the moved node and removed every later sibling there: a
		// second modal opened while the first was fading out simply vanished.
		// Hydration is out of reach here; the guard is the shape that makes the
		// walk safe: an owned placeholder that never leaves the tree.
		const a = render(PortalInBlock, { label: "a" });
		const placeholder = a.container.querySelector("div.contents");
		expect(placeholder).not.toBeNull();
		expect(placeholder?.childElementCount).toBe(0);
		// The moved node is the nearest portal wrapper above the content, parented by body.
		expect(inBody("a")?.closest("div.contents")?.parentElement).toBe(document.body);
	});

	it("tearing one portal down leaves the portals opened after it alone", async () => {
		const a = render(PortalInBlock, { label: "a" });
		const b = render(PortalInBlock, { label: "b" });
		const marker = document.createElement("div");
		marker.dataset.portal = "marker";
		document.body.appendChild(marker);
		try {
			await a.rerender({ show: false });
			await gone("a");
			expect(inBody("b")).not.toBeNull();
			expect(inBody("marker")).not.toBeNull();
		} finally {
			marker.remove();
			b.unmount();
		}
	});
});
