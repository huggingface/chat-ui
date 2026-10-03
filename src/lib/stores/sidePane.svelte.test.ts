import { afterEach, describe, expect, it } from "vitest";
import { sidePane } from "./sidePane.svelte";

afterEach(() => sidePane.reset());

describe("sidePane.switchConversation", () => {
	it("keeps each conversation's pane as it was left", () => {
		sidePane.openTrackio("https://a.hf.space", "a");
		sidePane.switchConversation("conv-a", "conv-b");
		expect(sidePane.open).toBe(false);

		sidePane.switchConversation("conv-b", "conv-a");
		expect(sidePane.open).toBe(true);
		expect(sidePane.view).toBe("trackio");
		expect(sidePane.trackio?.url).toBe("https://a.hf.space");

		sidePane.close();
		sidePane.switchConversation("conv-a", "conv-b");
		sidePane.switchConversation("conv-b", "conv-a");
		expect(sidePane.open).toBe(false);
	});

	it("does not auto-open again a dashboard that already auto-opened there", () => {
		sidePane.maybeAutoOpenTrackio("https://a.hf.space", "a");
		sidePane.close();
		sidePane.switchConversation("conv-a", "conv-b");
		sidePane.switchConversation("conv-b", "conv-a");

		sidePane.maybeAutoOpenTrackio("https://a.hf.space", "a");
		expect(sidePane.open).toBe(false);
	});
});
