import TrackioPane from "./TrackioPane.svelte";
import { render } from "vitest-browser-svelte";
import { afterEach, describe, expect, it } from "vitest";
import { tick } from "svelte";
import { sidePane } from "$lib/stores/sidePane.svelte";

const DASH = "https://me-mnist-trackio.hf.space";
const items = [{ kind: "trackio" as const, url: DASH, label: "me/mnist-trackio" }];

const addButton = (root: ParentNode) =>
	Array.from(root.querySelectorAll("button")).find((b) => b.textContent?.includes("Add to chat"));

function speak(from: Window | null, origin: string, type = "ready") {
	window.dispatchEvent(
		new MessageEvent("message", {
			data: { protocol: "trackio-view", version: 1, type },
			origin,
			source: from,
		})
	);
}

afterEach(() => sidePane.reset());

describe("TrackioPane view capture", () => {
	it("offers Add to chat only once its own dashboard says it can", async () => {
		sidePane.openTrackio(DASH, "me/mnist-trackio");
		const { container } = render(TrackioPane, { items });
		await tick();
		const frame = container.querySelector("iframe") as HTMLIFrameElement;
		expect(addButton(container)).toBeUndefined();

		// Another window, or this frame from the wrong origin, does not count.
		speak(window, new URL(DASH).origin);
		speak(frame.contentWindow, "https://evil.hf.space");
		await tick();
		expect(addButton(container)).toBeUndefined();

		speak(frame.contentWindow, new URL(DASH).origin);
		await tick();
		expect(addButton(container)).toBeDefined();
	});
});
