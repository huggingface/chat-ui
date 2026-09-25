import { describe, expect, it } from "vitest";
import type {
	MlRegistryAgentRun,
	MlRegistryArtefact,
	MlRegistryService,
	MlRegistrySource,
} from "$lib/types/MlRegistry";
import {
	fileLanguage,
	groupSources,
	runBadge,
	runElapsed,
	sortServiceRows,
	splitSettled,
	isSettledRow,
	sourcePath,
	sourceReaders,
	sourcesByReader,
	formatAgo,
	formatBytes,
	formatElapsed,
	formatFileRef,
	groupArtefacts,
	harnessEventLabel,
	hubLabel,
	isServiceOpen,
	pathWithin,
	serviceDisplayName,
	serviceElapsed,
	servicesForFileVersion,
	sortServices,
	stageBadge,
} from "./mlRegistry";

const T0 = Date.UTC(2026, 8, 25, 12, 0, 0);
const at = (offsetMs: number) => new Date(T0 + offsetMs);

const service = (overrides: Partial<MlRegistryService> = {}): MlRegistryService => ({
	id: "svc",
	kind: "job",
	jobId: "0123456789abcdef01234567",
	namespace: "pngwn",
	stage: "RUNNING",
	origin: "dispatched",
	hubUrl: "https://huggingface.co/jobs/pngwn/0123456789abcdef01234567",
	createdAt: at(0),
	updatedAt: at(0),
	...overrides,
});

const artefact = (overrides: Partial<MlRegistryArtefact> = {}): MlRegistryArtefact => ({
	id: "art",
	kind: "model",
	uri: "hf://models/pngwn/x",
	url: "https://huggingface.co/pngwn/x",
	origin: "dispatched",
	createdAt: at(0),
	updatedAt: at(0),
	...overrides,
});

describe("isServiceOpen", () => {
	it("counts the stages the Hub still bills", () => {
		expect(isServiceOpen({ stage: "SCHEDULING" })).toBe(true);
		expect(isServiceOpen({ stage: "RUNNING" })).toBe(true);
		for (const stage of ["COMPLETED", "CANCELED", "ERROR", "DELETED"]) {
			expect(isServiceOpen({ stage, heldMicroUsd: 1 })).toBe(false);
		}
	});

	it("takes a hold as the word on an unknown stage", () => {
		expect(isServiceOpen({ stage: "UNKNOWN" })).toBe(false);
		expect(isServiceOpen({ stage: "UNKNOWN", heldMicroUsd: 500_000 })).toBe(true);
	});
});

describe("stageBadge", () => {
	it("maps every hub stage and falls back to unknown", () => {
		expect(stageBadge("RUNNING")).toEqual({ label: "running", tone: "running" });
		expect(stageBadge("SCHEDULING")).toEqual({ label: "queued", tone: "queued" });
		expect(stageBadge("COMPLETED")).toEqual({ label: "completed", tone: "completed" });
		expect(stageBadge("ERROR")).toEqual({ label: "error", tone: "error" });
		expect(stageBadge("CANCELED")).toEqual({ label: "cancelled", tone: "cancelled" });
		expect(stageBadge("DELETED")).toEqual({ label: "deleted", tone: "cancelled" });
		expect(stageBadge("UNKNOWN")).toEqual({ label: "unknown", tone: "unknown" });
		expect(stageBadge("SOMETHING_NEW").tone).toBe("unknown");
	});
});

describe("serviceDisplayName", () => {
	it("prefers the model's name and falls back to a short job id", () => {
		expect(serviceDisplayName(service({ name: "sft-smoke" }))).toBe("sft-smoke");
		expect(serviceDisplayName(service({ name: "  " }))).toBe("01234567");
		expect(serviceDisplayName(service())).toBe("01234567");
	});
});

describe("harnessEventLabel", () => {
	const event = { jobId: "0123456789abcdef01234567", name: "sft-smoke", ranSeconds: 137 };

	it("says how the service ended and after how long", () => {
		expect(harnessEventLabel({ ...event, to: "ERROR" })).toBe("sft-smoke failed after 2m 17s");
		expect(harnessEventLabel({ ...event, to: "COMPLETED" })).toBe(
			"sft-smoke completed after 2m 17s"
		);
		expect(harnessEventLabel({ ...event, to: "CANCELED" })).toBe(
			"sft-smoke cancelled after 2m 17s"
		);
		expect(harnessEventLabel({ ...event, to: "DELETED", ranSeconds: undefined })).toBe(
			"sft-smoke deleted"
		);
	});

	it("names an unnamed service by its short id and a stage it does not know as ended", () => {
		expect(harnessEventLabel({ ...event, name: undefined, to: "TIMEOUT" })).toBe(
			"01234567 ended after 2m 17s"
		);
	});
});

describe("formatElapsed", () => {
	it("picks two units and pads the trailing one", () => {
		expect(formatElapsed(0)).toBe("0s");
		expect(formatElapsed(42_000)).toBe("42s");
		expect(formatElapsed(12 * 60_000 + 5_000)).toBe("12m 05s");
		expect(formatElapsed(3 * 3_600_000 + 5 * 60_000 + 59_000)).toBe("3h 05m");
		expect(formatElapsed(2 * 86_400_000 + 4 * 3_600_000)).toBe("2d 4h");
		expect(formatElapsed(-5_000)).toBe("0s");
	});
});

describe("serviceElapsed", () => {
	it("says queued for while scheduling", () => {
		expect(serviceElapsed(service({ stage: "SCHEDULING" }), T0 + 90_000)).toBe("queued for 1m 30s");
	});

	it("runs from startedAt, else createdAt, to now", () => {
		expect(serviceElapsed(service({ startedAt: at(60_000) }), T0 + 180_000)).toBe("2m 00s");
		expect(serviceElapsed(service(), T0 + 180_000)).toBe("3m 00s");
	});

	it("stops at endedAt, and at the last write for a terminal row without one", () => {
		const ended = service({ stage: "COMPLETED", startedAt: at(0), endedAt: at(600_000) });
		expect(serviceElapsed(ended, T0 + 10 * 3_600_000)).toBe("10m 00s");
		const lastWritten = service({ stage: "ERROR", updatedAt: at(120_000) });
		expect(serviceElapsed(lastWritten, T0 + 10 * 3_600_000)).toBe("2m 00s");
	});

	it("says nothing for a discovered row", () => {
		expect(serviceElapsed(service({ origin: "discovered", stage: "UNKNOWN" }), T0 + 1)).toBe(
			undefined
		);
	});
});

describe("sortServices", () => {
	it("puts running first, then queued, then the rest, newest first within each", () => {
		const done = service({ id: "done", stage: "COMPLETED", createdAt: at(300_000) });
		const oldRunning = service({ id: "old-running", createdAt: at(0) });
		const queued = service({ id: "queued", stage: "SCHEDULING", createdAt: at(100_000) });
		const held = service({
			id: "held",
			stage: "UNKNOWN",
			heldMicroUsd: 1,
			createdAt: at(200_000),
		});
		const failed = service({ id: "failed", stage: "ERROR", createdAt: at(50_000) });
		expect(sortServices([done, oldRunning, queued, held, failed]).map((s) => s.id)).toEqual([
			"old-running",
			"held",
			"queued",
			"done",
			"failed",
		]);
	});
});

describe("groupArtefacts", () => {
	it("nests files under their repo and keeps dashboards apart", () => {
		const model = artefact({ id: "model" });
		const sibling = artefact({
			id: "sibling",
			uri: "hf://models/pngwn/x-2",
			url: "https://huggingface.co/pngwn/x-2",
			createdAt: at(1),
		});
		const config = artefact({
			id: "config",
			kind: "file",
			uri: "hf://models/pngwn/x/configs/sft.yaml",
			url: "https://huggingface.co/pngwn/x/blob/main/configs/sft.yaml",
			commit: "abcdef0123456789",
		});
		const readme = artefact({
			id: "readme",
			kind: "file",
			uri: "hf://models/pngwn/x/README.md",
			url: "https://huggingface.co/pngwn/x/blob/main/README.md",
		});
		const stray = artefact({
			id: "stray",
			kind: "file",
			uri: "hf://datasets/pngwn/gone/data.parquet",
			url: "https://huggingface.co/datasets/pngwn/gone/blob/main/data.parquet",
		});
		const dashboard = artefact({
			id: "dash",
			kind: "dashboard",
			uri: "hf://spaces/pngwn/trackio",
			url: "https://huggingface.co/spaces/pngwn/trackio",
		});

		const grouped = groupArtefacts([dashboard, stray, sibling, readme, config, model]);

		expect(grouped.repos.map(({ repo, files }) => [repo.id, files.map((f) => f.id)])).toEqual([
			["model", ["config", "readme"]],
			["sibling", []],
		]);
		expect(grouped.orphans.map((f) => f.id)).toEqual(["stray"]);
		expect(grouped.dashboards.map((d) => d.id)).toEqual(["dash"]);
		expect(pathWithin(config, model)).toBe("configs/sft.yaml");
	});
});

describe("hubLabel", () => {
	it("drops the scheme and repo type", () => {
		expect(hubLabel("hf://spaces/pngwn/trackio")).toBe("pngwn/trackio");
		expect(hubLabel("hf://datasets/pngwn/gone/data.parquet")).toBe("pngwn/gone/data.parquet");
		expect(hubLabel("not-a-uri")).toBe("not-a-uri");
	});
});

describe("servicesForFileVersion", () => {
	it("keeps the services whose script was that version, running first", () => {
		const done = service({
			id: "done",
			stage: "COMPLETED",
			scriptRefs: [{ name: "train.py", version: 2 }],
		});
		const running = service({
			id: "running",
			createdAt: at(-60_000),
			scriptRefs: [{ name: "train.py", version: 2 }],
		});
		const other = service({ id: "other", scriptRefs: [{ name: "train.py", version: 1 }] });
		const inline = service({ id: "inline" });

		const ran = servicesForFileVersion([done, other, inline, running], {
			name: "train.py",
			version: 2,
		});

		expect(ran.map((s) => s.id)).toEqual(["running", "done"]);
		expect(servicesForFileVersion([done], { name: "eval.py", version: 2 })).toEqual([]);
	});
});

describe("file formatting", () => {
	it("names a version the way the tool card and the pane show it", () => {
		expect(formatFileRef({ name: "configs/sft.yaml", version: 12 })).toBe("configs/sft.yaml v12");
	});

	it("gives sizes in bytes, then KB with one decimal under 10", () => {
		expect(formatBytes(812)).toBe("812 B");
		expect(formatBytes(3277)).toBe("3.2 KB");
		expect(formatBytes(240 * 1024)).toBe("240 KB");
		expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
	});

	it("says how long ago in one coarse unit", () => {
		expect(formatAgo(10_000)).toBe("just now");
		expect(formatAgo(5 * 60_000)).toBe("5m ago");
		expect(formatAgo(3 * 3_600_000 + 59 * 60_000)).toBe("3h ago");
		expect(formatAgo(2 * 86_400_000)).toBe("2d ago");
		expect(formatAgo(-5_000)).toBe("just now");
	});

	it("highlights by extension and leaves anything unknown plain", () => {
		expect(fileLanguage("train.py")).toBe("python");
		expect(fileLanguage("configs/sft.YML")).toBe("yaml");
		expect(fileLanguage("run.sh")).toBe("bash");
		expect(fileLanguage("pyproject.toml")).toBe("plaintext");
		expect(fileLanguage("Dockerfile")).toBe("plaintext");
	});
});

const run = (overrides: Partial<MlRegistryAgentRun> = {}): MlRegistryAgentRun => ({
	id: "run-1",
	label: "research",
	displayName: "Research",
	taskPreview: "Research task: find recipes",
	parent: { tool: "research", toolUuid: "tool-1" },
	status: "completed",
	startedAt: at(0),
	endedAt: at(65_000),
	iterations: 4,
	callCount: 6,
	sourceCount: 2,
	...overrides,
});

describe("sub-agent runs", () => {
	it("badges each status in its own tone", () => {
		expect(runBadge(run({ status: "running" }))).toEqual({ label: "running", tone: "running" });
		expect(runBadge(run()).tone).toBe("completed");
		expect(runBadge(run({ status: "failed" }))).toEqual({ label: "failed", tone: "error" });
		expect(runBadge(run({ status: "aborted" }))).toEqual({ label: "stopped", tone: "cancelled" });
		expect(runBadge(run({ status: "interrupted" }))).toEqual({
			label: "interrupted",
			tone: "unknown",
		});
	});

	it("times an ended run by its end and a running one by now", () => {
		expect(runElapsed(run(), T0 + 999_999)).toBe("1m 05s");
		const running = run({ status: "running", endedAt: undefined });
		expect(runElapsed(running, T0 + 12_000)).toBe("12s");
		expect(runElapsed(run({ status: "interrupted", endedAt: undefined }), T0)).toBeUndefined();
	});

	it("sorts runs among services, running ones with the running jobs, newest first", () => {
		const rows = sortServiceRows(
			[
				service({ id: "old-job", stage: "COMPLETED", createdAt: at(0) }),
				service({ id: "live-job", stage: "RUNNING", createdAt: at(10) }),
			],
			[
				run({ id: "done", startedAt: at(20) }),
				run({ id: "live", status: "running", endedAt: undefined, startedAt: at(5) }),
			]
		);
		expect(rows.map((row) => row.key)).toEqual([
			"service:live-job",
			"run:live",
			"run:done",
			"service:old-job",
		]);
	});

	it("settles what has ended and what the agent was told, never what it was not", () => {
		const rows = sortServiceRows(
			[
				service({ id: "told", stage: "COMPLETED", lastReportedStage: "COMPLETED" }),
				service({ id: "untold", stage: "ERROR" }),
				service({ id: "moved-on", stage: "ERROR", lastReportedStage: "RUNNING" }),
				service({ id: "live", stage: "RUNNING", lastReportedStage: "RUNNING" }),
			],
			[
				run({ id: "done" }),
				run({ id: "failed", status: "failed" }),
				run({ id: "stopped", status: "aborted" }),
				run({ id: "cut", status: "interrupted" }),
				run({ id: "going", status: "running", endedAt: undefined }),
			]
		);
		const { active, settled } = splitSettled(rows);
		expect(settled.map((row) => row.key).sort()).toEqual(
			["service:told", "run:done", "run:failed", "run:stopped"].sort()
		);
		expect(active.map((row) => row.key).sort()).toEqual(
			["service:untold", "service:moved-on", "service:live", "run:cut", "run:going"].sort()
		);
		expect(isSettledRow(rows[0])).toBe(false);
	});
});

const source = (overrides: Partial<MlRegistrySource> = {}): MlRegistrySource => ({
	id: "s",
	url: "https://example.com/a",
	group: "example.com",
	kind: "web",
	opened: true,
	readBy: ["parent"],
	openedBy: overrides.opened === false ? [] : (overrides.readBy ?? ["parent"]),
	firstSeenAt: at(0),
	lastSeenAt: at(0),
	count: 1,
	...overrides,
});

describe("sources", () => {
	it("groups by group, most read first, found-only results apart, newest first in each", () => {
		const groups = groupSources([
			source({ id: "w1", url: "https://example.com/a", lastSeenAt: at(1) }),
			source({ id: "w2", url: "https://example.com/b", opened: false }),
			source({ id: "a1", url: "https://arxiv.org/abs/1", group: "arxiv.org", lastSeenAt: at(1) }),
			source({ id: "a2", url: "https://arxiv.org/abs/2", group: "arxiv.org", lastSeenAt: at(2) }),
			source({
				id: "g1",
				url: "https://github.com/huggingface/trl/blob/HEAD/x.py",
				group: "huggingface/trl",
				kind: "github",
				opened: false,
			}),
			source({
				id: "h1",
				url: "https://huggingface.co/huggingface/trl",
				group: "huggingface/trl",
				kind: "hub",
			}),
		]);
		expect(
			groups.map((g) => [g.label, g.kind, g.opened.map((s) => s.id), g.found.map((s) => s.id)])
		).toEqual([
			["arxiv.org", "web", ["a2", "a1"], []],
			["example.com", "web", ["w1"], ["w2"]],
			["huggingface/trl", "hub", ["h1"], []],
			["huggingface/trl", "github", [], ["g1"]],
		]);
	});

	it("labels a source by where it sits in its group", () => {
		expect(sourcePath(source({ url: "https://example.com/" }))).toBe("/");
		expect(sourcePath(source({ url: "https://example.com/a%20b?q=1" }))).toBe("/a b?q=1");
		expect(sourcePath({ url: "https://huggingface.co/papers/2502.16161", kind: "paper" })).toBe(
			"2502.16161"
		);
		expect(sourcePath({ url: "https://huggingface.co/docs/trl/sft_trainer", kind: "docs" })).toBe(
			"trl/sft_trainer"
		);
		expect(
			sourcePath({
				url: "https://github.com/huggingface/trl/blob/a1b2c3d/examples/scripts/sft.py",
				kind: "github",
			})
		).toBe("examples/scripts/sft.py");
		expect(
			sourcePath({
				url: "https://huggingface.co/datasets/o/n/blob/main/data/train.json",
				kind: "hub",
			})
		).toBe("data/train.json");
		expect(sourcePath({ url: "https://huggingface.co/datasets/o/n", kind: "hub" })).toBe(
			"repo page"
		);
	});

	it("lists what each reader opened apart from what only came back to it", () => {
		const found = source({ id: "p", readBy: ["parent", "run-1"], openedBy: ["run-1"] });
		const byReader = sourcesByReader([found, source({ id: "q", readBy: ["run-1"] })]);
		expect(byReader.get("parent")).toEqual({ opened: [], found: [found] });
		expect(byReader.get("run-1")?.opened.map((s) => s.id)).toEqual(["p", "q"]);
	});

	it("names the main agent and each run that read a source", () => {
		const readers = sourceReaders(["parent", "run-1", "gone"], [run()]);
		expect(readers.map((reader) => reader.label)).toEqual(["main", "research", "sub-agent"]);
		expect(readers[1].title).toContain("research sub-agent");
	});
});
