import MlRegistryPane from "./MlRegistryPane.svelte";
import { render } from "vitest-browser-svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import superjson from "superjson";
import { tick } from "svelte";
import { mlRegistry } from "$lib/stores/mlRegistry.svelte";
import { sidePane } from "$lib/stores/sidePane.svelte";
import type { MlFileListing, MlFileVersionListing } from "$lib/types/MlFile";
import type {
	MlAgentRunDetail,
	MlRegistryAgentRun,
	MlRegistryArtefact,
	MlRegistryPayload,
	MlRegistryService,
	MlRegistrySource,
} from "$lib/types/MlRegistry";

const NOW = Date.UTC(2026, 8, 25, 12, 0, 0);
const at = (offsetMs: number) => new Date(NOW + offsetMs);

const ORANGE_INK = "rgb(196, 81, 26)";
const GREEN_INK = "rgb(21, 128, 61)";
const RED_INK = "rgb(185, 28, 28)";
const TEXT_FAINT = "rgb(120, 113, 108)";

const JOB = "0123456789abcdef01234567";

const service = (overrides: Partial<MlRegistryService>): MlRegistryService => ({
	id: overrides.jobId ?? JOB,
	kind: "job",
	jobId: JOB,
	namespace: "pngwn",
	stage: "RUNNING",
	origin: "dispatched",
	hubUrl: `https://huggingface.co/jobs/pngwn/${overrides.jobId ?? JOB}`,
	createdAt: at(-3_600_000),
	updatedAt: at(-3_600_000),
	...overrides,
});

const artefact = (
	overrides: Partial<MlRegistryArtefact> & { uri: string }
): MlRegistryArtefact => ({
	id: overrides.uri,
	kind: "model",
	url: `https://huggingface.co/${overrides.uri.replace("hf://models/", "")}`,
	origin: "dispatched",
	createdAt: at(-1_800_000),
	updatedAt: at(-1_800_000),
	...overrides,
});

const RUNNING = service({
	name: "sft-smoke",
	flavor: "a10g-small",
	startedAt: at(-12 * 60_000 - 5_000),
	heldMicroUsd: 1_200_000,
});
const COMPLETED = service({
	jobId: "1".repeat(24),
	name: "baseline-eval",
	flavor: "cpu-basic",
	stage: "COMPLETED",
	createdAt: at(-7_200_000),
	startedAt: at(-7_000_000),
	endedAt: at(-7_000_000 + 3 * 3_600_000 + 5 * 60_000),
});
const ERRORED = service({
	jobId: "2".repeat(24),
	flavor: "a10g-small",
	stage: "ERROR",
	createdAt: at(-5_400_000),
	updatedAt: at(-5_400_000 + 42_000),
});
const DISCOVERED = service({
	jobId: "3".repeat(24),
	kind: "sandbox",
	stage: "UNKNOWN",
	origin: "discovered",
	namespace: "someone-else",
	createdAt: at(-60_000),
});
const MODEL = artefact({ uri: "hf://models/pngwn/sft-smoke" });
const CONFIG = artefact({
	uri: "hf://models/pngwn/sft-smoke/configs/sft.yaml",
	kind: "file",
	url: "https://huggingface.co/pngwn/sft-smoke/blob/main/configs/sft.yaml",
	commit: "abcdef0123456789",
});
const README = artefact({
	uri: "hf://models/pngwn/sft-smoke/README.md",
	kind: "file",
	url: "https://huggingface.co/pngwn/sft-smoke/blob/main/README.md",
});
const DASHBOARD = artefact({
	uri: "hf://spaces/pngwn/trackio",
	kind: "dashboard",
	url: "https://huggingface.co/spaces/pngwn/trackio",
	createdAt: at(-1_000_000),
});

const payload = (over: Partial<MlRegistryPayload> = {}): MlRegistryPayload => ({
	services: [COMPLETED, RUNNING, ERRORED, DISCOVERED],
	artefacts: [README, DASHBOARD, MODEL, CONFIG],
	files: [],
	serverNow: NOW,
	...over,
});

const find = (root: ParentNode, selector: string): HTMLElement => {
	const el = root.querySelector<HTMLElement>(selector);
	if (!el) throw new Error(`no element matching ${selector}`);
	return el;
};
const all = (root: ParentNode, selector: string) => [
	...root.querySelectorAll<HTMLElement>(selector),
];
const style = (el: Element) => getComputedStyle(el);
const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, " ").trim();

/** null mounts before any payload */
function mount(data: MlRegistryPayload | null = payload()) {
	mlRegistry.reset();
	mlRegistry.bind("conv-1");
	if (data) mlRegistry.apply(data);
	sidePane.openRegistry();
	return render(MlRegistryPane);
}

describe("MlRegistryPane", () => {
	beforeEach(() => {
		// only the clock, timers stay real so svelte scheduling is untouched
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(NOW);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("{}", { status: 500 }))
		);
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		sidePane.reset();
		mlRegistry.reset();
	});

	it("only renders as the registry view of the side pane", () => {
		mlRegistry.apply(payload());
		sidePane.reset();
		const closed = render(MlRegistryPane);
		expect(closed.container.querySelector("aside, [role=dialog]")).toBeNull();

		sidePane.openTrackio("https://x.hf.space", "x/y");
		expect(closed.container.querySelector("aside, [role=dialog]")).toBeNull();

		const { container } = mount();
		const pane = find(container, "[aria-label='Services and artifacts']");
		expect(text(pane.querySelector("h2"))).toBe("Services and artifacts");
	});

	it("closes from its own header", () => {
		const { container } = mount();
		find(container, "button[title^='Close panel']").click();
		expect(sidePane.open).toBe(false);
	});

	it("closes once its conversation is left", async () => {
		mount();
		expect(sidePane.open).toBe(true);
		mlRegistry.reset();
		await vi.waitFor(() => expect(sidePane.open).toBe(false));
	});

	it("lists running rows first, then the rest newest first", () => {
		const { container } = mount();
		const names = all(container, ".ml-service .ml-registry-link").map((a) => a.textContent?.trim());
		expect(names).toEqual(["sft-smoke", "33333333", "22222222", "baseline-eval"]);
	});

	it("badges each stage in its own colour", () => {
		const { container } = mount();
		const badges = all(container, ".ml-stage");
		const byTone = Object.fromEntries(badges.map((b) => [b.dataset.tone, b]));

		expect(text(byTone.running)).toBe("running");
		expect(style(byTone.running).color).toBe(ORANGE_INK);
		expect(byTone.running.querySelector(".ml-live-dot")).not.toBeNull();
		expect(style(find(byTone.running, ".ml-live-dot")).animationName).toContain("ml-live-pulse");

		expect(text(byTone.completed)).toBe("completed");
		expect(style(byTone.completed).color).toBe(GREEN_INK);
		expect(text(byTone.error)).toBe("error");
		expect(style(byTone.error).color).toBe(RED_INK);
		expect(text(byTone.unknown)).toBe("unknown");
		expect(style(byTone.unknown).color).toBe(TEXT_FAINT);
		expect(all(container, ".ml-live-dot")).toHaveLength(1);
	});

	it("renders elapsed times against the server clock", () => {
		const { container } = mount();
		const rows = all(container, ".ml-service");
		const elapsedOf = (row: HTMLElement) => text(row.querySelector(".ml-service-elapsed"));

		expect(elapsedOf(rows[0])).toBe("12m 05s");
		expect(elapsedOf(rows[1])).toBeUndefined();
		expect(elapsedOf(rows[2])).toBe("42s");
		expect(elapsedOf(rows[3])).toBe("3h 05m");
	});

	it("says queued for while a job is scheduling", () => {
		const { container } = mount(
			payload({ services: [service({ stage: "SCHEDULING", createdAt: at(-90_000) })] })
		);
		expect(text(find(container, ".ml-service-elapsed"))).toBe("queued for 1m 30s");
		expect(text(find(container, ".ml-stage"))).toBe("queued");
	});

	it("shows what a running job still holds, in orange, and nothing once settled", () => {
		const { container } = mount();
		const rows = all(container, ".ml-service");

		const hold = find(rows[0], ".ml-service-hold");
		expect(text(hold)).toBe("holds $1.20");
		expect(style(hold).color).toBe(ORANGE_INK);
		expect(rows[3].querySelector(".ml-service-hold")).toBeNull();
	});

	it("names a service by the model's name, else its short job id, and links it to the Hub", () => {
		const { container } = mount();
		const links = all(container, ".ml-service .ml-registry-link") as HTMLAnchorElement[];

		expect(links[0].textContent?.trim()).toBe("sft-smoke");
		expect(links[0].href).toBe(`https://huggingface.co/jobs/pngwn/${JOB}`);
		expect(links[0].target).toBe("_blank");
		expect(links[0].rel).toBe("noopener noreferrer");
		expect(links[2].textContent?.trim()).toBe("22222222");
	});

	it("shows kind and flavor in the meta line", () => {
		const { container } = mount();
		const rows = all(container, ".ml-service");
		expect(text(rows[0].querySelector(".ml-service-meta"))).toBe(
			"job · a10g-small · 12m 05s · holds $1.20"
		);
		expect(text(rows[1].querySelector(".ml-service-meta"))).toBe("sandbox");
	});

	it("marks discovered rows as unverified", () => {
		const { container } = mount();
		const marks = all(container, ".ml-service .ml-registry-discovered");
		expect(marks).toHaveLength(1);
		expect(marks[0].closest(".ml-service")?.textContent).toContain("33333333");
		expect(marks[0].title).toMatch(/nothing about it is verified/);
		expect(style(marks[0]).borderTopStyle).toBe("dashed");
	});

	it("explains a row the poller can no longer check", () => {
		const { container } = mount(
			payload({ services: [service({ stage: "UNKNOWN", tokenMissingSince: at(-60_000) })] })
		);
		expect(container.textContent).toContain("Status unknown since the session expired.");
	});

	it("nests a repo's files under it, with their commit, then lists dashboards", () => {
		const { container } = mount();
		const rows = all(container, ".ml-artefact");
		expect(rows.map((row) => row.dataset.kind)).toEqual(["model", "dashboard"]);

		const repo = rows[0];
		const repoLink = find(repo, ":scope > div > .ml-registry-link") as HTMLAnchorElement;
		expect(repoLink.textContent?.trim()).toBe("pngwn/sft-smoke");
		expect(repoLink.href).toBe("https://huggingface.co/pngwn/sft-smoke");
		expect(text(repo.querySelector(":scope > div"))).toContain("model");

		const files = all(repo, ".ml-artefact-files li");
		expect(files.map((li) => li.querySelector("a")?.textContent?.trim())).toEqual([
			"configs/sft.yaml",
			"README.md",
		]);
		expect((files[0].querySelector("a") as HTMLAnchorElement).href).toBe(
			"https://huggingface.co/pngwn/sft-smoke/blob/main/configs/sft.yaml"
		);
		expect(text(files[0])).toContain("abcdef0");
		expect(text(files[1])).not.toContain("abcdef0");

		const dashboardLink = find(rows[1], ".ml-registry-link") as HTMLAnchorElement;
		expect(dashboardLink.textContent?.trim()).toBe("pngwn/trackio");
		expect(dashboardLink.href).toBe("https://huggingface.co/spaces/pngwn/trackio");
		expect(text(rows[1])).toContain("dashboard");
	});

	it("shows an empty state per section", () => {
		const { container } = mount(payload({ services: [], artefacts: [] }));
		const empties = all(container, ".ml-registry-empty").map(text);
		expect(empties).toHaveLength(4);
		expect(empties[0]).toMatch(/^No jobs, sandboxes or research runs yet/);
		expect(empties[1]).toMatch(/^Nothing on the Hub yet/);
		expect(empties[2]).toMatch(/^No files yet/);
		expect(empties[3]).toMatch(/^No sources yet/);
		expect(container.querySelector(".ml-registry-list")).toBeNull();
	});

	it("says it is loading until the first payload lands", () => {
		const { container } = mount(null);
		expect(text(find(container, "[role=status]"))).toBe("Loading…");
		expect(container.querySelector("section")).toBeNull();
	});

	it("counts open services in the header", () => {
		const { container } = mount();
		expect(text(find(container, "header"))).toContain("1 running");
	});

	it("asks the registry again when it opens and when refreshed", async () => {
		// each answer carries its own clock, so the test waits for a fetch to land, not to start
		let answered = 0;
		const fetch = vi.fn(async (_input: RequestInfo | URL) => {
			answered += 1;
			return new Response(superjson.stringify(payload({ serverNow: NOW + answered })), {
				status: 200,
			});
		});
		const landed = (n: number) => vi.waitFor(() => expect(mlRegistry.serverNow).toBe(NOW + n));
		vi.stubGlobal("fetch", fetch);
		mlRegistry.reset();
		const stop = mlRegistry.watch("conv-1", { live: false });
		await landed(1);

		sidePane.openRegistry();
		const { container } = render(MlRegistryPane);
		await landed(2);
		expect(String(fetch.mock.calls[1][0])).toContain("/api/v2/conversations/conv-1/registry");

		find(container, "button[aria-label='Refresh the list']").click();
		await landed(3);
		expect(fetch).toHaveBeenCalledTimes(3);
		stop();
	});
});

describe("MlRegistryPane files", () => {
	const TRAIN = [
		"import torch\nlr = 1e-4\nprint(lr)\n",
		"import torch\nlr = 3e-4\nprint(lr)\n",
		"import torch\nlr = 3e-4\nepochs = 3\nprint(lr)\n",
	];
	const SOURCE = `hfsb2:pngwn:${"4".repeat(24)}:/work/train.py`;
	const VERSIONS: Record<string, MlFileVersionListing[]> = {
		"train.py": [
			{
				version: 3,
				size: 3277,
				origin: "import",
				source: SOURCE,
				agent: "sandbox_task",
				summary: "add epochs",
				createdAt: at(-5 * 60_000),
			},
			{ version: 2, size: 36, origin: "edit", summary: "raise lr", createdAt: at(-30 * 60_000) },
			{ version: 1, size: 36, origin: "write", createdAt: at(-2 * 3_600_000) },
		],
	};
	const CONTENTS: Record<string, string[]> = { "train.py": TRAIN };
	const FILES: MlFileListing[] = [
		{ name: "configs/sft.yaml", version: 1, size: 812, updatedAt: at(-3 * 3_600_000) },
		{ name: "train.py", version: 3, size: 3277, updatedAt: at(-5 * 60_000), summary: "add epochs" },
	];
	const RAN_V3 = service({ ...RUNNING, scriptRefs: [{ name: "train.py", version: 3 }] });
	const RAN_V2 = service({ ...ERRORED, scriptRefs: [{ name: "train.py", version: 2 }] });

	function serveFiles(): string[] {
		const calls: string[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) => {
				const url = new URL(String(input));
				const [, rest] = url.pathname.split("/files/");
				if (rest === undefined) return new Response("{}", { status: 500 });
				calls.push(`${decodeURIComponent(rest)}${url.search}`);
				const name = decodeURIComponent(rest);
				const version = url.searchParams.get("version");
				const body =
					version === null
						? { name, versions: VERSIONS[name] }
						: {
								name,
								...VERSIONS[name].find((entry) => entry.version === Number(version)),
								content: CONTENTS[name][Number(version) - 1],
							};
				return new Response(superjson.stringify(body), { status: 200 });
			})
		);
		return calls;
	}

	const mountFiles = () =>
		mount(payload({ services: [RAN_V3, COMPLETED, RAN_V2], artefacts: [], files: FILES }));
	const fileRow = (root: ParentNode, name: string) =>
		all(root, ".ml-file").find((row) => text(row.querySelector(".ml-file-name")) === name) ??
		(() => {
			throw new Error(`no file row ${name}`);
		})();
	const pill = (root: ParentNode, name: string, version: number) =>
		find(fileRow(root, name), `.ml-version-pill[data-version='${version}']`);
	const pressed = (root: ParentNode, name: string) =>
		all(fileRow(root, name), ".ml-version-pill[aria-pressed='true']").map(text);
	const panel = (root: ParentNode, name: string) => find(fileRow(root, name), ".ml-version");
	const described = async (root: ParentNode, name: string, version: number) => {
		await vi.waitFor(() => {
			const shown = panel(root, name);
			expect(shown.dataset.version).toBe(String(version));
			expect(shown.querySelector(".ml-version-origin")).not.toBeNull();
		});
		return panel(root, name);
	};
	const codeOf = async (row: HTMLElement) => {
		await vi.waitFor(() => expect(row.querySelector(".ml-file-code")).not.toBeNull());
		return find(row, ".ml-file-code");
	};

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(NOW);
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		sidePane.reset();
		mlRegistry.reset();
	});

	it("lists each file with its size, age and a pill per version, newest first", () => {
		serveFiles();
		const { container } = mountFiles();

		expect(text(find(container, "#ml-registry-files"))).toBe("Files 2");
		const rows = all(container, ".ml-file");
		expect(rows.map((row) => text(row.querySelector(".ml-file-name")))).toEqual([
			"configs/sft.yaml",
			"train.py",
		]);
		expect(all(rows[1], ".ml-version-pill").map(text)).toEqual(["v3", "v2", "v1"]);
		expect(all(rows[0], ".ml-version-pill").map(text)).toEqual(["v1"]);
		expect(text(rows[1].querySelector(".ml-file-meta"))).toBe("3.2 KB · updated 5m ago");
		expect(text(rows[1])).not.toContain("add epochs");
		expect(find(rows[1], ".ml-file-toggle").getAttribute("aria-expanded")).toBe("false");
		expect(pressed(container, "train.py")).toEqual([]);
	});

	it("opens a file on its latest version, and only then asks for its versions and content", async () => {
		const calls = serveFiles();
		const { container } = mountFiles();
		expect(calls).toEqual([]);

		find(fileRow(container, "train.py"), ".ml-file-toggle").click();
		await described(container, "train.py", 3);

		expect(find(fileRow(container, "train.py"), ".ml-file-toggle").ariaExpanded).toBe("true");
		expect(pressed(container, "train.py")).toEqual(["v3"]);
		await codeOf(panel(container, "train.py"));
		expect(calls).toEqual(
			expect.arrayContaining(["train.py", "train.py?version=3", "train.py?version=2"])
		);
	});

	it("says how the picked version came about and which jobs ran it", async () => {
		serveFiles();
		const { container } = mountFiles();
		const jobsOf = (row: HTMLElement) =>
			all(row, ".ml-version-jobs li").map((li) => [
				text(li.querySelector("a")),
				li.querySelector<HTMLElement>(".ml-stage")?.dataset.tone,
			]);

		find(fileRow(container, "train.py"), ".ml-file-toggle").click();
		const v3 = await described(container, "train.py", 3);
		expect(text(v3.querySelector(".ml-version-origin"))).toBe("imported");
		expect(text(v3.querySelector(".ml-version-agent"))).toBe("sandbox_task");
		expect(text(v3.querySelector(".ml-version-summary"))).toBe("add epochs");
		expect(text(v3.querySelector(".ml-version-source"))).toBe(`from ${SOURCE}`);
		expect(jobsOf(v3)).toEqual([["sft-smoke", "running"]]);
		expect((find(v3, ".ml-version-jobs a") as HTMLAnchorElement).href).toBe(RAN_V3.hubUrl);

		pill(container, "train.py", 2).click();
		const v2 = await described(container, "train.py", 2);
		expect(text(v2.querySelector(".ml-version-origin"))).toBe("edited");
		expect(v2.querySelector(".ml-version-agent")).toBeNull();
		expect(jobsOf(v2)).toEqual([["22222222", "error"]]);

		pill(container, "train.py", 1).click();
		const v1 = await described(container, "train.py", 1);
		expect(text(v1.querySelector(".ml-version-origin"))).toBe("written");
		expect(jobsOf(v1)).toEqual([]);
	});

	it("shows what a version changed against the one before, with counts, and the whole file on request", async () => {
		const calls = serveFiles();
		const { container } = mountFiles();

		pill(container, "train.py", 2).click();
		const row = await described(container, "train.py", 2);
		const code = await codeOf(row);

		expect(pressed(container, "train.py")).toEqual(["v2"]);
		expect(code.classList.contains("diff-view")).toBe(true);
		expect(all(code, ".diff-del").map(text)).toEqual(["- lr = 1e-4"]);
		expect(all(code, ".diff-add").map(text)).toEqual(["+ lr = 3e-4"]);
		expect(text(row.querySelector(".ml-file-view-stats"))).toBe("+1 −1");
		expect(text(row.querySelector(".ml-file-view-bar"))).toContain("v1 → v2");
		expect(calls.filter((call) => call.includes("?"))).toEqual([
			"train.py?version=2",
			"train.py?version=1",
		]);

		const toggle = all(row, ".ml-file-view-toggle button");
		expect(toggle.map((button) => [text(button), button.getAttribute("aria-pressed")])).toEqual([
			["Changes", "true"],
			["Whole file", "false"],
		]);
		toggle[1].click();
		await vi.waitFor(() => expect(code.querySelector(".diff-line")).toBeNull());
		expect(code.classList.contains("diff-view")).toBe(false);
		expect(code.textContent).toBe(TRAIN[1]);
	});

	it("shows the first version in full, with nothing to compare it to", async () => {
		const calls = serveFiles();
		const { container } = mountFiles();

		pill(container, "train.py", 1).click();
		const row = await described(container, "train.py", 1);
		const code = await codeOf(row);

		expect(code.textContent).toBe(TRAIN[0]);
		expect(code.querySelector(".diff-line")).toBeNull();
		expect(row.querySelector(".ml-file-view-toggle")).toBeNull();
		expect(text(row.querySelector(".ml-file-view-bar"))).toBe("The first version, in full");
		expect(calls.filter((call) => call.includes("?"))).toEqual(["train.py?version=1"]);
	});

	it("closes when the picked pill or the row is clicked again, and reopens on the latest", async () => {
		serveFiles();
		const { container } = mountFiles();

		pill(container, "train.py", 2).click();
		await described(container, "train.py", 2);
		pill(container, "train.py", 2).click();
		await tick();
		expect(fileRow(container, "train.py").querySelector(".ml-version")).toBeNull();
		expect(pressed(container, "train.py")).toEqual([]);

		const toggle = find(fileRow(container, "train.py"), ".ml-file-toggle");
		toggle.click();
		await described(container, "train.py", 3);
		toggle.click();
		await tick();
		expect(fileRow(container, "train.py").querySelector(".ml-version")).toBeNull();
	});

	it("names the script version each job ran and opens it under Files", async () => {
		serveFiles();
		const { container } = mountFiles();

		const chips = all(container, ".ml-service .ml-file-ref");
		expect(chips.map(text)).toEqual(["train.py v3", "train.py v2"]);
		chips[1].click();

		const row = await described(container, "train.py", 2);
		await codeOf(row);
		expect(pressed(container, "train.py")).toEqual(["v2"]);
	});

	it("keeps file ages moving when nothing is running", async () => {
		vi.useRealTimers();
		vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
		vi.setSystemTime(NOW);
		serveFiles();
		const { container } = mount(payload({ services: [COMPLETED], artefacts: [], files: FILES }));
		const meta = () => text(fileRow(container, "train.py").querySelector(".ml-file-meta"));
		expect(meta()).toBe("3.2 KB · updated 5m ago");

		await tick();
		vi.advanceTimersByTime(3 * 60_000);

		await vi.waitFor(() => expect(meta()).toBe("3.2 KB · updated 8m ago"));
	});

	it("says so when the versions cannot be read, and tries again", async () => {
		serveFiles();
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("{}", { status: 500 }))
		);
		const { container } = mountFiles();
		find(fileRow(container, "train.py"), ".ml-file-toggle").click();
		await vi.waitFor(() =>
			expect(text(fileRow(container, "train.py").querySelector(".ml-file-note"))).toMatch(
				/^Could not load the versions/
			)
		);

		serveFiles();
		find(fileRow(container, "train.py"), ".ml-file-retry").click();
		await described(container, "train.py", 3);
	});
});

describe("MlRegistryPane sub-agent runs and sources", () => {
	const RESEARCH: MlRegistryAgentRun = {
		id: "65f000000000000000000001",
		label: "research",
		displayName: "Research",
		taskPreview: "Research task: find a working SFT recipe for SmolLM2",
		parent: { tool: "research", toolUuid: "tool-1", messageId: "msg-1" },
		status: "completed",
		startedAt: at(-10 * 60_000),
		endedAt: at(-10 * 60_000 + 65_000),
		iterations: 5,
		callCount: 7,
		sourceCount: 3,
	};
	const LIVE_RUN: MlRegistryAgentRun = {
		id: "65f000000000000000000002",
		label: "research",
		displayName: "Research",
		taskPreview: "Research task: compare LoRA ranks for a 360M model",
		parent: { tool: "research", toolUuid: "tool-2" },
		status: "running",
		startedAt: at(-42_000),
		iterations: 2,
		callCount: 3,
		sourceCount: 0,
	};
	const FAILED: MlRegistryAgentRun = {
		...RESEARCH,
		id: "65f000000000000000000003",
		taskPreview: "Research task: find why DPO loss diverges",
		parent: { tool: "research", toolUuid: "tool-3" },
		status: "failed",
		failure: "iteration_limit",
		error: "Research agent hit the iteration limit",
		startedAt: at(-3 * 60_000),
		endedAt: at(-60_000),
		sourceCount: 0,
	};
	const DETAIL: MlAgentRunDetail = {
		...RESEARCH,
		task: "Context: the user wants to fine-tune SmolLM2\n\nResearch task: find a working SFT recipe for SmolLM2",
		summary: "Use TRL SFTTrainer with packing.\nThe example is examples/scripts/sft.py.",
		calls: [
			{ tool: "hf_fs", args: '{"operations":[{"cmd":"cat"}]}', status: "success" },
			{ tool: "crawling_exa", args: '{"urls":["https://x"]}', status: "error", error: "timeout" },
		],
	};

	const source = (
		over: Partial<MlRegistrySource> & { id: string; url: string }
	): MlRegistrySource => ({
		group: "arxiv.org",
		kind: "web",
		opened: true,
		readBy: [RESEARCH.id],
		openedBy: over.opened === false ? [] : (over.readBy ?? [RESEARCH.id]),
		firstSeenAt: at(-9 * 60_000),
		lastSeenAt: at(-9 * 60_000),
		count: 1,
		...over,
	});
	const SOURCES: MlRegistrySource[] = [
		source({ id: "s1", url: "https://arxiv.org/abs/2502.16161", title: "OmniParser V2" }),
		source({
			id: "s2",
			url: "https://arxiv.org/abs/2305.14233",
			readBy: ["parent", RESEARCH.id],
			lastSeenAt: at(-60_000),
		}),
		source({ id: "s3", url: "https://arxiv.org/abs/9999.00001", opened: false }),
		source({
			id: "s4",
			url: "https://huggingface.co/papers/2502.16161",
			group: "Hugging Face papers",
			kind: "paper",
			title: "OmniParser V2 on the Hub",
			readBy: ["parent"],
		}),
		source({
			id: "s5",
			url: "https://github.com/huggingface/trl/blob/HEAD/examples/scripts/sft.py",
			group: "huggingface/trl",
			kind: "github",
			opened: false,
		}),
	];

	function serveRun(detail: MlAgentRunDetail = DETAIL): string[] {
		const calls: string[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) => {
				const url = new URL(String(input));
				if (!url.pathname.includes("/runs/")) return new Response("{}", { status: 500 });
				calls.push(url.pathname);
				return new Response(superjson.stringify(detail), { status: 200 });
			})
		);
		return calls;
	}

	const mountRuns = (over: Partial<MlRegistryPayload> = {}) =>
		mount(
			payload({
				services: [COMPLETED, RUNNING],
				agentRuns: [RESEARCH, LIVE_RUN, FAILED],
				artefacts: [],
				sources: SOURCES,
				...over,
			})
		);
	const runRow = (root: ParentNode, id: string) => find(root, `#ml-run-${id}`);
	const openEnded = async (root: ParentNode) => {
		find(root, ".ml-settled-toggle").click();
		await tick();
	};
	const groupRow = (root: ParentNode, label: string) =>
		all(root, ".ml-source-group").find(
			(row) => text(row.querySelector(".ml-source-label")) === label
		) ??
		(() => {
			throw new Error(`no source group ${label}`);
		})();

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(NOW);
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		sidePane.reset();
		mlRegistry.reset();
	});

	it("lists runs among the services, and folds what ended and was reported under them", async () => {
		serveRun();
		const { container } = mountRuns({
			services: [COMPLETED, RUNNING, { ...ERRORED, lastReportedStage: "ERROR" }],
		});
		await tick();

		const idOf = (row: Element) => row.id || row.className.split(" ")[0];
		const [active] = all(container, ".ml-registry-list");
		expect([...active.children].map(idOf)).toEqual([
			`ml-run-${LIVE_RUN.id}`,
			"ml-service",
			"ml-service",
		]);
		const toggle = find(container, ".ml-settled-toggle");
		expect(text(toggle)).toBe("3 ended");
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
		expect(container.querySelector("#ml-registry-settled")).toBeNull();

		await openEnded(container);
		expect([...find(container, "#ml-registry-settled").children].map(idOf)).toEqual([
			`ml-run-${FAILED.id}`,
			`ml-run-${RESEARCH.id}`,
			"ml-service",
		]);
		expect(text(find(container, "#ml-registry-services"))).toBe("Services 6");
		expect(text(find(container, "header h2 + span"))).toBe("2 running");
	});

	it("shows a run's name, status, calls, time and what it read", async () => {
		serveRun();
		const { container } = mountRuns();
		await tick();
		await openEnded(container);

		const research = runRow(container, RESEARCH.id);
		expect(text(research.querySelector(".ml-file-toggle span"))).toContain("Research");
		const badge = find(research, ".ml-stage");
		expect(badge.dataset.tone).toBe("completed");
		expect(style(badge).color).toBe(GREEN_INK);
		expect(text(research.querySelector(".ml-file-toggle"))).not.toContain(RESEARCH.taskPreview);
		expect(text(research.querySelector(".ml-service-meta"))).toBe(
			"7 calls · 1m 05s · 2 sources read"
		);

		const live = runRow(container, LIVE_RUN.id);
		expect(text(live.querySelector(".ml-stage"))).toBe("running");
		expect(live.querySelector(".ml-live-dot")).not.toBeNull();
		expect(text(live.querySelector(".ml-service-meta"))).toBe("3 calls · 42s");

		const failed = runRow(container, FAILED.id);
		expect(find(failed, ".ml-stage").dataset.tone).toBe("error");
		const note = find(failed, ".ml-run-note");
		expect(text(note)).toBe("hit its step limit");
		expect(style(note).color).toBe(RED_INK);
	});

	it("keeps an interrupted run in view, since the agent never got its result", async () => {
		serveRun();
		const { container } = mountRuns({
			agentRuns: [{ ...LIVE_RUN, status: "interrupted", endedAt: at(-30_000) }],
		});
		await tick();

		const stuck = runRow(container, LIVE_RUN.id);
		expect(stuck.closest("#ml-registry-settled")).toBeNull();
		expect(text(stuck.querySelector(".ml-stage"))).toBe("interrupted");
		expect(stuck.querySelector(".ml-live-dot")).toBeNull();
		expect(text(stuck.querySelector(".ml-service-meta"))).toBe("3 calls · 12s");
	});

	it("expands a run to its task, summary, calls and sources, fetched only when opened", async () => {
		const calls = serveRun();
		const { container } = mountRuns();
		await tick();
		await openEnded(container);
		expect(calls).toEqual([]);

		const research = runRow(container, RESEARCH.id);
		const toggle = find(research, ".ml-file-toggle");
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
		toggle.click();
		await vi.waitFor(() => expect(research.querySelector(".ml-run-summary")).not.toBeNull());

		expect(toggle.getAttribute("aria-expanded")).toBe("true");
		expect(calls).toEqual([`/api/v2/conversations/conv-1/runs/${RESEARCH.id}`]);
		const detail = find(research, ".ml-run-detail");
		const labels = all(detail, ".ml-run-label").map(text);
		expect(labels).toEqual(["Task", "Summary", "Calls 7", "Sources 2"]);
		expect(find(detail, ".ml-run-text").textContent).toBe(DETAIL.task);
		expect(find(detail, ".ml-run-summary").textContent).toBe(DETAIL.summary);

		const callRows = all(detail, ".ml-run-calls li");
		expect(callRows.map((row) => row.dataset.status)).toEqual(["success", "error"]);
		expect(text(callRows[0])).toBe('hf_fs {"operations":[{"cmd":"cat"}]}');
		expect(text(callRows[1].querySelector(".ml-run-note"))).toBe("timeout");
		expect(text(detail)).toContain("5 later calls not kept.");

		const read = all(detail, ".ml-run-sources a");
		expect(read.map((a) => [text(a), a.getAttribute("href")])).toEqual([
			["/abs/2305.14233", "https://arxiv.org/abs/2305.14233"],
			["OmniParser V2", "https://arxiv.org/abs/2502.16161"],
		]);
		expect(
			read.every(
				(a) =>
					a.getAttribute("target") === "_blank" && a.getAttribute("rel") === "noopener noreferrer"
			)
		).toBe(true);
		expect(text(detail)).toContain("2 more links only in its search results");

		toggle.click();
		await tick();
		expect(research.querySelector(".ml-run-detail")).toBeNull();
	});

	it("says so when a run cannot be read, and tries again", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("{}", { status: 500 }))
		);
		const { container } = mountRuns();
		await tick();
		await openEnded(container);
		const research = runRow(container, RESEARCH.id);
		find(research, ".ml-file-toggle").click();
		await vi.waitFor(() => expect(text(research)).toContain("Could not load the run."));

		const calls = serveRun();
		find(research, ".ml-file-retry").click();
		await vi.waitFor(() => expect(research.querySelector(".ml-run-summary")).not.toBeNull());
		expect(calls).toHaveLength(1);
	});

	it("groups sources, most read first, each with how many were read and found", async () => {
		serveRun();
		const { container } = mountRuns();
		await tick();

		expect(text(find(container, "#ml-registry-sources"))).toBe("Sources 5");
		const groups = all(container, ".ml-source-group");
		expect(
			groups.map((row) => [row.dataset.kind, text(row.querySelector(".ml-file-toggle"))])
		).toEqual([
			["web", "arxiv.org 2 read 1 found"],
			["paper", "Hugging Face papers 1 read"],
			["github", "huggingface/trl 1 found"],
		]);
		expect(container.querySelector(".ml-source")).toBeNull();
	});

	it("expands a group to its paths, read first, search-only results apart and dimmed", async () => {
		serveRun();
		const { container } = mountRuns();
		await tick();

		const arxiv = groupRow(container, "arxiv.org");
		find(arxiv, ".ml-file-toggle").click();
		await tick();

		const [readList, foundList] = all(arxiv, ".ml-source-paths");
		expect(readList.dataset.found).toBeUndefined();
		expect(all(readList, ".ml-source-link").map(text)).toEqual([
			"/abs/2305.14233",
			"OmniParser V2",
		]);
		expect(text(find(readList, ".ml-source-path"))).toBe("/abs/2502.16161");
		expect(text(find(arxiv, ".ml-source-found-heading"))).toBe("Only in search results");
		expect(foundList.dataset.found).toBe("true");
		const dimmed = find(foundList, ".ml-source-link");
		expect(dimmed.getAttribute("href")).toBe("https://arxiv.org/abs/9999.00001");
		expect(style(dimmed).color).not.toBe(style(find(readList, ".ml-source-link")).color);

		const readers = all(readList.children[0], ".ml-source-reader");
		expect(readers.map((reader) => [reader.tagName, text(reader)])).toEqual([
			["SPAN", "main"],
			["BUTTON", "research"],
		]);
	});

	it("never credits a page to a reader that only found it in search results", async () => {
		serveRun();
		const foundByResearch = source({
			id: "s6",
			url: "https://arxiv.org/abs/2401.00001",
			readBy: ["parent", RESEARCH.id],
			openedBy: ["parent"],
		});
		const { container } = mountRuns({ sources: [...SOURCES, foundByResearch] });
		await tick();
		await openEnded(container);

		const research = runRow(container, RESEARCH.id);
		expect(text(research.querySelector(".ml-service-meta"))).toContain("2 sources read");
		find(research, ".ml-file-toggle").click();
		await vi.waitFor(() => expect(research.querySelector(".ml-run-sources")).not.toBeNull());
		expect(all(research, ".ml-run-sources a").map((a) => a.getAttribute("href"))).not.toContain(
			foundByResearch.url
		);

		const arxiv = groupRow(container, "arxiv.org");
		find(arxiv, ".ml-file-toggle").click();
		await tick();
		const row = all(arxiv, ".ml-source").find(
			(li) => li.querySelector("a")?.getAttribute("href") === foundByResearch.url
		);
		expect(all(row ?? document.body, ".ml-source-reader").map(text)).toEqual(["main"]);
	});

	it("goes from a source's reader to the run that read it", async () => {
		serveRun();
		const { container } = mountRuns();
		await tick();
		const arxiv = groupRow(container, "arxiv.org");
		find(arxiv, ".ml-file-toggle").click();
		await tick();

		find(arxiv, "button.ml-source-reader").click();
		await vi.waitFor(() =>
			expect(runRow(container, RESEARCH.id).querySelector(".ml-run-summary")).not.toBeNull()
		);
		const research = runRow(container, RESEARCH.id);
		expect(research.closest("#ml-registry-settled")).not.toBeNull();
		expect(find(research, ".ml-file-toggle").getAttribute("aria-expanded")).toBe("true");
	});

	it("renders a payload from a server that predates runs and sources", async () => {
		const { container } = mount(payload({ agentRuns: undefined, sources: undefined }));
		await tick();
		expect(container.querySelector(".ml-run")).toBeNull();
		expect(text(find(container, "#ml-registry-sources"))).toBe("Sources");
	});

	it("fits a phone width without scrolling sideways", async () => {
		serveRun();
		const { container } = mountRuns();
		await tick();
		await openEnded(container);
		const scroller = find(container, ".ml-registry");
		scroller.style.width = "340px";
		find(groupRow(container, "arxiv.org"), ".ml-file-toggle").click();
		find(runRow(container, RESEARCH.id), ".ml-file-toggle").click();
		await vi.waitFor(() => expect(container.querySelector(".ml-run-summary")).not.toBeNull());
		expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth);
	});
});
