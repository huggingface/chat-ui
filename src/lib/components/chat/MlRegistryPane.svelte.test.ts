import MlRegistryPane from "./MlRegistryPane.svelte";
import { render } from "vitest-browser-svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import superjson from "superjson";
import { mlRegistry } from "$lib/stores/mlRegistry.svelte";
import { sidePane } from "$lib/stores/sidePane.svelte";
import type {
	MlRegistryArtefact,
	MlRegistryPayload,
	MlRegistryService,
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
		const pane = find(container, "[aria-label='Services and artefacts']");
		expect(text(pane.querySelector("h2"))).toBe("Services and artefacts");
	});

	it("closes from its own header", () => {
		const { container } = mount();
		find(container, "button[title^='Close panel']").click();
		expect(sidePane.open).toBe(false);
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
		expect(empties).toHaveLength(2);
		expect(empties[0]).toMatch(/^No jobs or sandboxes yet/);
		expect(empties[1]).toMatch(/^Nothing on the Hub yet/);
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
