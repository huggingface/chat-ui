import ToolUpdate from "./ToolUpdate.svelte";
import MlRegistryPane from "./MlRegistryPane.svelte";
import { render } from "vitest-browser-svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import superjson from "superjson";
import { mlRegistry } from "$lib/stores/mlRegistry.svelte";
import { sidePane } from "$lib/stores/sidePane.svelte";

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

describe("ToolUpdate virtual file chips", () => {
	const submit = {
		...call,
		call: { name: "hf_jobs", parameters: { operation: "uv" } },
		fileRefs: [{ ref: "v-file://train.py@v2", name: "train.py", version: 2 }],
	};
	const versions = [3, 2, 1].map((version) => ({
		version,
		size: 9,
		origin: version === 1 ? "write" : "edit",
		createdAt: new Date(version * 1000),
	}));

	afterEach(() => {
		vi.unstubAllGlobals();
		sidePane.reset();
		mlRegistry.reset();
	});

	it("names the version the call sent and opens the files list at it", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) => {
				const url = new URL(String(input));
				if (!url.pathname.endsWith("/files/train.py")) return new Response("{}", { status: 500 });
				const version = url.searchParams.get("version");
				const body = version
					? { name: "train.py", ...versions[3 - Number(version)], content: `print(${version})\n` }
					: { name: "train.py", versions };
				return new Response(superjson.stringify(body), { status: 200 });
			})
		);
		mlRegistry.bind("conv-1");
		mlRegistry.apply({
			services: [],
			artefacts: [],
			files: [{ name: "train.py", version: 3, size: 9, updatedAt: new Date(3000) }],
			serverNow: Date.now(),
		});
		const pane = render(MlRegistryPane);
		const card = render(ToolUpdate, { tool: [submit] } as never);

		const chip = card.container.querySelector<HTMLButtonElement>("button.tool-file-ref");
		expect(chip?.textContent?.trim()).toBe("train.py v2");
		chip?.click();

		expect(sidePane.open).toBe(true);
		expect(sidePane.view).toBe("registry");
		expect(sidePane.registryFocus).toEqual({ name: "train.py", version: 2 });
		await vi.waitFor(() => {
			const row = pane.container.querySelector(".ml-version[data-version='2']");
			expect(row?.querySelector(".ml-version-toggle")?.getAttribute("aria-pressed")).toBe("true");
			expect(row?.querySelector(".ml-file-code .diff-add")?.textContent).toBe("+ print(2)");
		});
		expect(pane.container.querySelector(".ml-file-toggle")?.getAttribute("aria-expanded")).toBe(
			"true"
		);
	});

	it("shows the version without a way to open it where there is no registry, as on a share", () => {
		const { container } = render(ToolUpdate, { tool: [submit] } as never);

		expect(container.querySelector("button.tool-file-ref")).toBeNull();
		expect(container.querySelector("span.tool-file-ref")?.textContent?.trim()).toBe("train.py v2");
	});

	it("shows no chip for a call that carried no reference", () => {
		mlRegistry.bind("conv-1");
		const { container } = render(ToolUpdate, { tool: [call] } as never);
		expect(container.querySelector(".tool-file-ref")).toBeNull();
	});
});
