import ActivityGroup from "./ActivityGroup.svelte";
import { render } from "vitest-browser-svelte";
import { describe, expect, it } from "vitest";
import {
	MessageToolUpdateType,
	MessageUpdateType,
	type MessageToolUpdate,
	type MessageUpdate,
} from "$lib/types/MessageUpdate";
import { ToolResultStatus } from "$lib/types/Tool";
import { activityLabels } from "$lib/utils/activity";

const call = (uuid: string, name: string, args: Record<string, unknown>): MessageToolUpdate => ({
	type: MessageUpdateType.Tool,
	subtype: MessageToolUpdateType.Call,
	uuid,
	call: { name, parameters: {} },
	argumentsRaw: JSON.stringify(args),
});
const ok = (uuid: string, name: string): MessageToolUpdate => ({
	type: MessageUpdateType.Tool,
	subtype: MessageToolUpdateType.Result,
	uuid,
	result: {
		status: ToolResultStatus.Success,
		call: { name, parameters: {} },
		outputs: [{ text: "ok" }],
		display: true,
	},
});
const failed = (uuid: string): MessageToolUpdate => ({
	type: MessageUpdateType.Tool,
	subtype: MessageToolUpdateType.Error,
	uuid,
	message: "403 Forbidden",
});
const tool = (uuid: string, updates: MessageToolUpdate[], round = 0) =>
	({ type: "tool", uuid, updates, round }) as const;
const think = (content: string, round = 0, closed = true) =>
	({ type: "think", content, closed, round }) as const;
const label = (round: number, phase: "thinking" | "summary" | "tools", text: string) =>
	({ type: MessageUpdateType.ActivityLabel, round, phase, text }) as MessageUpdate;

const noLabels = activityLabels([]);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, " ").trim();

describe("ActivityGroup", () => {
	const finishedRun = [
		think("Fetch the primary leaderboards."),
		tool("a", [
			call("a", "crawling_exa", { url: "https://artificialanalysis.ai/models" }),
			ok("a", "crawling_exa"),
		]),
		tool("b", [call("b", "crawling_exa", { url: "https://lmarena.ai/leaderboard" }), failed("b")]),
		tool("c", [
			call("c", "web_search_exa", { query: "arena.ai open models" }),
			ok("c", "web_search_exa"),
		]),
	];

	it("sums up a finished run in one line and names what failed apart", () => {
		const { container } = render(ActivityGroup, { blocks: finishedRun, labels: noLabels });
		expect(text(container.querySelector("button"))).toBe(
			"Read artificialanalysis.ai, searched the web · couldn't read lmarena.ai"
		);
		expect(container.textContent).not.toContain("crawling_exa");
	});

	it("lists every step when opened, thinking as its summary and tools in words", async () => {
		const labels = activityLabels([label(0, "summary", "Going to the primary leaderboards")]);
		const { container } = render(ActivityGroup, { blocks: finishedRun, labels });
		container.querySelector("button")?.click();
		await tick();
		const rows = [...container.querySelectorAll(".rounded-xl button[aria-expanded]")];
		expect(rows.map(text)).toEqual([
			"Going to the primary leaderboards",
			"Read artificialanalysis.ai https://artificialanalysis.ai/models",
			"Couldn't read lmarena.ai https://lmarena.ai/leaderboard Failed",
			"Searched the web arena.ai open models",
		]);
	});

	it("shows the raw reasoning and the real tool call one level deeper", async () => {
		const { container } = render(ActivityGroup, { blocks: finishedRun, labels: noLabels });
		container.querySelector("button")?.click();
		await tick();
		const rows = [
			...container.querySelectorAll(".rounded-xl button[aria-expanded]"),
		] as HTMLButtonElement[];
		rows[0].click();
		rows[2].click();
		await tick();
		expect(container.textContent).toContain("Fetch the primary leaderboards.");
		expect(text(container.querySelector("code"))).toBe("crawling_exa");
		expect(container.textContent).toContain("403 Forbidden");
	});

	it("opens a single step straight to its content, with no one-row list", async () => {
		const { container } = render(ActivityGroup, {
			blocks: [
				tool("a", [
					call("a", "web_search_exa", { query: "latest Node LTS" }),
					ok("a", "web_search_exa"),
				]),
			],
			labels: noLabels,
		});
		const header = container.querySelector("button");
		expect(text(header)).toBe("Searched the web latest Node LTS");
		header?.click();
		await tick();
		expect(container.querySelector(".rounded-xl")).toBeNull();
		expect(text(container.querySelector("code"))).toBe("web_search_exa");
	});

	it("shows the task model's line for the round in progress, with a timer", async () => {
		const { container } = render(ActivityGroup, {
			blocks: [think("Search first"), tool("a", [call("a", "web_search_exa", { query: "x" })])],
			labels: activityLabels([label(0, "tools", "Searching the open leaderboards")]),
			active: true,
			loading: true,
		});
		await tick();
		const header = container.querySelector("button");
		expect(header?.textContent).toContain("Searching the open leaderboards");
		expect(header?.textContent).toMatch(/\d+s/);
		expect(header?.querySelector(".router-shimmer")).not.toBeNull();
	});

	it("falls back to present-tense rules while the current round has no label yet", async () => {
		const { container } = render(ActivityGroup, {
			blocks: [
				tool("a", [call("a", "web_search_exa", { query: "x" }), ok("a", "web_search_exa")], 0),
				tool("b", [call("b", "crawling_exa", { url: "https://arena.ai/x" })], 1),
			],
			labels: activityLabels([label(0, "tools", "Searching the open leaderboards")]),
			active: true,
			loading: true,
		});
		await tick();
		expect(container.querySelector("button")?.textContent).toContain("Reading arena.ai");
	});

	it("never says a finished call in the past tense while the run is still working", async () => {
		const { container } = render(ActivityGroup, {
			blocks: [tool("a", [call("a", "web_search_exa", { query: "x" }), ok("a", "web_search_exa")])],
			labels: noLabels,
			active: true,
			loading: true,
		});
		await tick();
		const header = text(container.querySelector("button"));
		expect(header).toContain("Thinking");
		expect(header).not.toContain("Searched");
	});

	it("describes a run of thinking alone by its summary, time or first sentence", () => {
		const labels = activityLabels([label(2, "summary", "Choosing how to draw the chart")]);
		const summed = render(ActivityGroup, { blocks: [think("Simple arithmetic.", 2)], labels });
		expect(text(summed.container.querySelector("button"))).toBe("Choosing how to draw the chart");
		const timed = render(ActivityGroup, {
			blocks: [think("Simple arithmetic.", 1)],
			labels: activityLabels([
				{ type: MessageUpdateType.ActivityTiming, round: 1, thinkingMs: 7_200 },
			]),
		});
		expect(text(timed.container.querySelector("button"))).toBe("Thought for 7s");
		const bare = render(ActivityGroup, {
			blocks: [think("Okay, the user wants a quick sum.")],
			labels: noLabels,
		});
		expect(text(bare.container.querySelector("button"))).toBe("The user wants a quick sum");
	});

	it("gives keyboard focus a visible ring and links the header to what it opens", async () => {
		const { container } = render(ActivityGroup, { blocks: finishedRun, labels: noLabels });
		const header = container.querySelector("button") as HTMLButtonElement;
		expect(header.className).toContain("focus-visible:ring-2");
		header.click();
		await tick();
		const panel = header.getAttribute("aria-controls");
		expect(panel && container.querySelector(`#${panel}`)).toBeTruthy();
	});
});
