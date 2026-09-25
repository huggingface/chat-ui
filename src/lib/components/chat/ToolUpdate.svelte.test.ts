import ToolUpdate from "./ToolUpdate.svelte";
import { render } from "vitest-browser-svelte";
import { describe, expect, it } from "vitest";
import { tick } from "svelte";

const call = {
	type: "tool",
	subtype: "call",
	uuid: "u1",
	call: { name: "sandbox_task", parameters: {} },
};
const progress = (message: string, step = 1) => ({
	type: "tool",
	subtype: "progress",
	uuid: "u1",
	progress: step,
	message,
});

const line =
	'▸ hf_sandbox {"sandbox":"sbx-1","command":"cd /work && python train.py --epochs 3 --lr 1e';
const progressRows = (el: HTMLElement) =>
	Array.from(el.querySelectorAll("span.truncate")).map((row) => row.textContent);

describe("ToolUpdate progress lines", () => {
	it("renders two parallel calls that produce the same line", () => {
		const { baseElement } = render(ToolUpdate, {
			tool: [call, progress(`${line}\n${line}`)],
			loading: true,
		} as never);

		expect(progressRows(baseElement as HTMLElement)).toEqual([line, line]);
	});

	it("survives a later update that introduces the repeat", async () => {
		const screen = render(ToolUpdate, {
			tool: [call, progress(`${line}\n▸ hf_fs {"path":"/work"}`)],
			loading: true,
		} as never);

		await screen.rerender({
			tool: [call, progress(`${line}\n▸ hf_fs {"path":"/work"}`), progress(`${line}\n${line}`, 2)],
		} as never);
		await tick();

		expect(progressRows(screen.baseElement as HTMLElement)).toEqual([line, line]);
	});
});

describe("ToolUpdate status icon", () => {
	const result = (status: "success" | "error") => ({
		type: "tool",
		subtype: "result",
		uuid: "u1",
		result: { status, call: call.call, outputs: [], message: "boom", display: true },
	});
	const icon = (el: Element, label: string) => el.querySelector(`svg[aria-label='${label}']`);

	it("warns instead of checking when the result itself is an error", () => {
		const { baseElement } = render(ToolUpdate, { tool: [call, result("error")] } as never);

		expect(icon(baseElement, "Failed")).not.toBeNull();
		expect(icon(baseElement, "Succeeded")).toBeNull();
		expect(baseElement.textContent).toContain("Error calling tool");
	});
});
