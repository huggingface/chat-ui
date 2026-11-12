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

describe("sidePane tabs", () => {
	it("opens one tab per thing and focuses an open one again", () => {
		sidePane.openTrackio("https://a.hf.space", "a");
		sidePane.openPaper("1706.03762", "Attention");
		sidePane.openTrackio("https://a.hf.space", "a");
		expect(sidePane.tabs.map((t) => t.id)).toEqual([
			"trackio:https://a.hf.space",
			"paper:1706.03762",
		]);
		expect(sidePane.view).toBe("trackio");
		expect(sidePane.trackio?.url).toBe("https://a.hf.space");
	});

	it("closing the showing tab goes back to the one shown before it", () => {
		sidePane.openTrackio("https://a.hf.space", "a");
		sidePane.openArtifact("chart");
		sidePane.openPaper("1706.03762", "Attention");
		sidePane.activate("trackio:https://a.hf.space");
		sidePane.activate("paper:1706.03762");
		sidePane.closeTab("paper:1706.03762");
		expect(sidePane.activeId).toBe("trackio:https://a.hf.space");
		sidePane.closeTab("trackio:https://a.hf.space");
		sidePane.closeTab("artifact:chart");
		expect(sidePane.open).toBe(false);
		expect(sidePane.tabs).toEqual([]);
	});

	it("keeps artifact state per tab", () => {
		sidePane.openArtifact("one");
		sidePane.selectTab("code");
		sidePane.openArtifact("two");
		expect(sidePane.tab).toBe("preview");
		sidePane.openArtifact("one");
		expect(sidePane.tab).toBe("code");
		expect(sidePane.userPinnedTab).toBe(true);
	});

	it("keeps recent live views mounted and nothing else", () => {
		sidePane.openArtifact("chart");
		for (let i = 0; i < 7; i++) sidePane.openTrackio(`https://d${i}.hf.space`, `d${i}`);
		const mounted = sidePane.mountedKeepAlive.map((t) => t.id);
		expect(mounted).toHaveLength(5);
		expect(mounted).toContain("trackio:https://d6.hf.space");
		expect(mounted).not.toContain("trackio:https://d0.hf.space");
		expect(mounted.some((id) => id.startsWith("artifact:"))).toBe(false);
	});

	it("auto-opens a workflow in the background when something else is showing", () => {
		sidePane.openPaper("1706.03762", "Attention");
		sidePane.maybeAutoOpenWorkflow({ url: "https://w.hf.space", label: "w", spaceId: "me/w" });
		expect(sidePane.view).toBe("paper");
		expect(sidePane.hasTab("workflow:https://w.hf.space")).toBe(true);
	});

	it("auto-opens a paper in the background when something else is showing", () => {
		sidePane.openTrackio("https://a.hf.space", "a");
		sidePane.maybeAutoOpenPaper("1706.03762", "Attention");
		expect(sidePane.view).toBe("trackio");
		expect(sidePane.tabs.map((t) => t.id)).toContain("paper:1706.03762");

		// with only papers showing, a new one comes to the front
		sidePane.activate("paper:1706.03762");
		sidePane.maybeAutoOpenPaper("1810.04805", "BERT");
		expect(sidePane.active?.id).toBe("paper:1810.04805");
	});

	it("bumps a paper target so the same passage can be flashed twice", () => {
		sidePane.openPaper("1706.03762", "Attention", { page: 3, quote: "x" });
		const first = sidePane.active?.kind === "paper" ? sidePane.active.target?.nonce : undefined;
		sidePane.openPaper("1706.03762", "Attention", { page: 3, quote: "x" });
		const second = sidePane.active?.kind === "paper" ? sidePane.active.target?.nonce : undefined;
		expect(second).toBe((first ?? 0) + 1);
		// opening without a target keeps the reader where it was
		sidePane.openPaper("1706.03762", "Attention");
		expect(sidePane.active?.kind === "paper" && sidePane.active.target?.page).toBe(3);
	});
});
