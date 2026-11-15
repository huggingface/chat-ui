import ToolCallsSummary from "./ToolCallsSummary.svelte";
import { render } from "vitest-browser-svelte";
import { page } from "@vitest/browser/context";

import { describe, expect, it, vi } from "vitest";

type ProcessBlock =
	{ type: "think"; content: string; closed: boolean } | { type: "tool"; uuid: string; updates: [] };

const thinkBlock = (content: string): ProcessBlock => ({ type: "think", content, closed: true });
const toolBlock = (uuid: string): ProcessBlock => ({ type: "tool", uuid, updates: [] });

describe("ToolCallsSummary", () => {
	it("is collapsed by default (children hidden)", async () => {
		const { baseElement } = render(ToolCallsSummary, {
			blocks: [thinkBlock("Reasoning A"), thinkBlock("Reasoning B")],
			toolCount: 0,
		});

		expect(baseElement.querySelector(".mt-1")).toBeNull();
	});

	it("labels the header by tool count", async () => {
		expect(
			render(ToolCallsSummary, { blocks: [toolBlock("a")], toolCount: 1 }).baseElement.textContent
		).toContain("Called 1 tool");

		expect(
			render(ToolCallsSummary, {
				blocks: [toolBlock("a"), toolBlock("b")],
				toolCount: 2,
			}).baseElement.textContent
		).toContain("Called 2 tools");
	});

	it("labels a tool-less run as 'Thought'", async () => {
		const { baseElement } = render(ToolCallsSummary, {
			blocks: [thinkBlock("A"), thinkBlock("B")],
			toolCount: 0,
		});
		expect(baseElement.textContent).toContain("Thought");
	});

	it("reveals indented child rows when expanded", async () => {
		const { baseElement } = render(ToolCallsSummary, {
			blocks: [thinkBlock("Reasoning A"), thinkBlock("Reasoning B")],
			toolCount: 0,
		});

		const toggle = baseElement.querySelector("button");
		if (!toggle) throw new Error("expected summary header button");
		toggle.click();
		await new Promise((r) => setTimeout(r, 0));

		expect(baseElement.querySelector(".mt-1")).not.toBeNull();
		expect(page.getByText("Thinking").elements()).toHaveLength(2);
		expect(page.getByText("Reasoning A").elements()).toHaveLength(0);
	});

	it("lets a tool's input be selected and copied while the headers stay unselectable", async () => {
		const writeText = vi.fn(async () => {});
		vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
		const updates = [
			{
				type: "tool",
				subtype: "call",
				uuid: "u1",
				call: { name: "hf_fs", parameters: { path: "/work" } },
			},
		];
		const { baseElement } = render(ToolCallsSummary, {
			blocks: [{ type: "tool", uuid: "u1", updates }],
			toolCount: 1,
		} as never);

		const headers = () => Array.from(baseElement.querySelectorAll("button[aria-label='Expand']"));
		(headers()[0] as HTMLButtonElement).click();
		await new Promise((r) => setTimeout(r, 0));
		(headers()[0] as HTMLButtonElement).click();
		await new Promise((r) => setTimeout(r, 0));

		const input = baseElement.querySelector("pre");
		if (!input) throw new Error("expected the input snippet");
		expect(getComputedStyle(input).userSelect).not.toBe("none");
		for (const header of baseElement.querySelectorAll("button[aria-label='Collapse']")) {
			expect(getComputedStyle(header).userSelect).toBe("none");
		}

		baseElement.querySelector<HTMLButtonElement>("button[title='Copy to clipboard']")?.click();
		await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(input.textContent));
		vi.unstubAllGlobals();
	});
});
