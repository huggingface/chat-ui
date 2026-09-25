import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import superjson from "superjson";
import type { MlFileVersionListing } from "$lib/types/MlFile";
import type {
	MlAgentRunDetail,
	MlRegistryAgentRun,
	MlRegistryPayload,
	MlRegistryService,
	MlRegistrySource,
} from "$lib/types/MlRegistry";

vi.mock("$app/environment", () => ({ browser: false, dev: true, building: false }));
vi.mock("$app/paths", () => ({ base: "" }));

const { ML_REGISTRY_POLL_MS, MlRegistryStore } = await import("./mlRegistry.svelte");

const service = (overrides: Partial<MlRegistryService> = {}): MlRegistryService => ({
	id: "svc",
	kind: "job",
	jobId: "0123456789abcdef01234567",
	namespace: "pngwn",
	stage: "RUNNING",
	origin: "dispatched",
	hubUrl: "https://huggingface.co/jobs/pngwn/0123456789abcdef01234567",
	createdAt: new Date(0),
	updatedAt: new Date(0),
	...overrides,
});

const agentRun = (overrides: Partial<MlRegistryAgentRun> = {}): MlRegistryAgentRun => ({
	id: "run-1",
	label: "research",
	displayName: "Research",
	taskPreview: "Research task: find recipes",
	parent: { tool: "research", toolUuid: "tool-1" },
	status: "running",
	startedAt: new Date(0),
	iterations: 1,
	callCount: 2,
	sourceCount: 0,
	...overrides,
});

const source = (path = "a"): MlRegistrySource => ({
	id: `source-${path}`,
	url: `https://example.com/${path}`,
	group: "example.com",
	kind: "web",
	opened: true,
	readBy: ["parent"],
	openedBy: ["parent"],
	firstSeenAt: new Date(0),
	lastSeenAt: new Date(0),
	count: 1,
});

const payload = (services: MlRegistryService[] = []): MlRegistryPayload => ({
	services,
	artefacts: [],
	files: [],
	serverNow: Date.now(),
});

function fakeFetch() {
	const calls: string[] = [];
	const queue: MlRegistryPayload[] = [];
	let fallback = payload();
	let suspended = false;
	const waiting: Array<() => void> = [];
	const fetcher = (async (input: RequestInfo | URL) => {
		calls.push(String(input));
		const answer = queue.shift() ?? fallback;
		if (suspended) await new Promise<void>((resolve) => waiting.push(resolve));
		return new Response(superjson.stringify(answer), { status: 200 });
	}) as typeof fetch;
	return {
		fetcher,
		calls,
		answer: (next: MlRegistryPayload) => queue.push(next),
		always: (next: MlRegistryPayload) => (fallback = next),
		suspend: () => (suspended = true),
		release: () => {
			suspended = false;
			waiting.splice(0).forEach((resume) => resume());
		},
	};
}

const flush = () => vi.advanceTimersByTimeAsync(0);

describe("mlRegistry store", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("fetches once on watch and reports the payload", async () => {
		const net = fakeFetch();
		const file = { name: "train.py", version: 1, size: 3, updatedAt: new Date(0) };
		net.answer({ ...payload([service()]), files: [file] });
		const store = new MlRegistryStore(net.fetcher);

		store.watch("conv-1", { live: false });
		await flush();

		expect(net.calls).toEqual(["http://localhost:5173/api/v2/conversations/conv-1/registry"]);
		expect(store.conversationId).toBe("conv-1");
		expect(store.loaded).toBe(true);
		expect(store.services).toHaveLength(1);
		expect(store.services[0].createdAt).toBeInstanceOf(Date);
		expect(store.files).toEqual([file]);
		expect(store.summary).toEqual({ rows: 2, open: 1, running: 1 });
	});

	it("counts files among the rows, so a conversation with only files shows the control", () => {
		const store = new MlRegistryStore(fakeFetch().fetcher);
		store.bind("conv-1");
		store.apply({
			...payload(),
			files: [{ name: "train.py", version: 3, size: 9, updatedAt: new Date(0) }],
		});
		expect(store.summary).toEqual({ rows: 1, open: 0, running: 0 });
	});

	it("counts sub-agent runs and sources among the rows, and neither as open", () => {
		const store = new MlRegistryStore(fakeFetch().fetcher);
		store.bind("conv-1");
		store.apply({ ...payload(), agentRuns: [agentRun()], sources: [source(), source("b")] });
		expect(store.summary).toEqual({ rows: 3, open: 0, running: 0 });
	});

	it("reads a payload from a server that predates runs and sources as empty lists", () => {
		const store = new MlRegistryStore(fakeFetch().fetcher);
		store.bind("conv-1");
		store.apply({ ...payload(), agentRuns: [agentRun()], sources: [source()] });
		store.apply(payload([service()]));
		expect(store.agentRuns).toEqual([]);
		expect(store.sources).toEqual([]);
		expect(store.summary.rows).toBe(1);
	});

	it("knows whether a turn is live, for a run left marked running", async () => {
		const net = fakeFetch();
		const store = new MlRegistryStore(net.fetcher);
		store.watch("conv-1", { live: true });
		expect(store.turnLive).toBe(true);
		store.watch("conv-1", { live: false });
		expect(store.turnLive).toBe(false);
		store.watch("conv-1", { live: true });
		store.reset();
		expect(store.turnLive).toBe(false);
	});

	it("forgets the conversation on reset", () => {
		const store = new MlRegistryStore(fakeFetch().fetcher);
		store.bind("conv-1");
		expect(store.conversationId).toBe("conv-1");
		store.reset();
		expect(store.conversationId).toBeUndefined();
		expect(store.loaded).toBe(false);
	});

	it("does not poll when no turn is live and nothing is open", async () => {
		const net = fakeFetch();
		net.answer(payload([service({ stage: "COMPLETED" })]));
		const store = new MlRegistryStore(net.fetcher);

		store.watch("conv-1", { live: false });
		await flush();
		await vi.advanceTimersByTimeAsync(ML_REGISTRY_POLL_MS * 10);

		expect(net.calls).toHaveLength(1);
		expect(store.openServices).toEqual([]);
	});

	it("polls every 5 s while a turn is live", async () => {
		const net = fakeFetch();
		const store = new MlRegistryStore(net.fetcher);

		const stop = store.watch("conv-1", { live: true });
		await flush();
		expect(net.calls).toHaveLength(1);

		await vi.advanceTimersByTimeAsync(ML_REGISTRY_POLL_MS - 1);
		expect(net.calls).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(net.calls).toHaveLength(2);
		await vi.advanceTimersByTimeAsync(ML_REGISTRY_POLL_MS * 3);
		expect(net.calls).toHaveLength(5);

		stop();
		await vi.advanceTimersByTimeAsync(ML_REGISTRY_POLL_MS * 3);
		expect(net.calls).toHaveLength(5);
	});

	it("refetches once when the turn ends, then stops", async () => {
		const net = fakeFetch();
		net.always(payload([service({ stage: "COMPLETED" })]));
		const store = new MlRegistryStore(net.fetcher);

		const stop = store.watch("conv-1", { live: true });
		await flush();
		stop();
		// the same effect re-running with the turn over
		store.watch("conv-1", { live: false });
		await flush();
		expect(net.calls).toHaveLength(2);

		await vi.advanceTimersByTimeAsync(ML_REGISTRY_POLL_MS * 3);
		expect(net.calls).toHaveLength(2);
	});

	it("keeps polling between turns while a service is open, and stops once it settles", async () => {
		const net = fakeFetch();
		net.answer(payload([service({ stage: "SCHEDULING" })]));
		net.answer(payload([service({ stage: "RUNNING" })]));
		net.answer(payload([service({ stage: "UNKNOWN", heldMicroUsd: 500_000 })]));
		net.always(payload([service({ stage: "UNKNOWN" })]));
		const store = new MlRegistryStore(net.fetcher);

		store.watch("conv-1", { live: false });
		await flush();
		expect(store.summary.open).toBe(1);

		await vi.advanceTimersByTimeAsync(ML_REGISTRY_POLL_MS);
		expect(net.calls).toHaveLength(2);
		await vi.advanceTimersByTimeAsync(ML_REGISTRY_POLL_MS);
		expect(net.calls).toHaveLength(3);
		expect(store.summary).toEqual({ rows: 1, open: 1, running: 0 });

		// unknown with no hold, nothing left to ask about
		await vi.advanceTimersByTimeAsync(ML_REGISTRY_POLL_MS);
		expect(net.calls).toHaveLength(4);
		expect(store.summary.open).toBe(0);
		await vi.advanceTimersByTimeAsync(ML_REGISTRY_POLL_MS * 5);
		expect(net.calls).toHaveLength(4);
	});

	it("refreshes on demand and resumes polling if that reveals an open service", async () => {
		const net = fakeFetch();
		net.answer(payload([]));
		const store = new MlRegistryStore(net.fetcher);

		store.watch("conv-1", { live: false });
		await flush();
		await vi.advanceTimersByTimeAsync(ML_REGISTRY_POLL_MS * 2);
		expect(net.calls).toHaveLength(1);

		net.always(payload([service()]));
		// the pane opening
		await store.refresh();
		expect(net.calls).toHaveLength(2);
		await vi.advanceTimersByTimeAsync(ML_REGISTRY_POLL_MS);
		expect(net.calls).toHaveLength(3);
	});

	it("shares one request between overlapping refreshes", async () => {
		const net = fakeFetch();
		const store = new MlRegistryStore(net.fetcher);
		net.suspend();

		store.watch("conv-1", { live: false });
		const again = store.refresh();
		const andAgain = store.refresh();
		net.release();
		await Promise.all([again, andAgain]);

		expect(net.calls).toHaveLength(1);
	});

	it("starts clean on another conversation and drops the old one's late answer", async () => {
		const net = fakeFetch();
		const store = new MlRegistryStore(net.fetcher);
		net.suspend();
		net.answer(payload([service({ id: "from-conv-1" })]));
		net.answer(payload([service({ id: "from-conv-2", stage: "COMPLETED" })]));

		const stop = store.watch("conv-1", { live: false });
		stop();
		store.watch("conv-2", { live: false });
		expect(store.loaded).toBe(false);
		net.release();
		await flush();

		expect(net.calls.map((url) => url.split("/conversations/")[1])).toEqual([
			"conv-1/registry",
			"conv-2/registry",
		]);
		expect(store.conversationId).toBe("conv-2");
		expect(store.services.map((s) => s.id)).toEqual(["from-conv-2"]);
	});

	it("survives a failed fetch and asks again on the next tick", async () => {
		let failures = 0;
		const fetcher = (async () => {
			failures += 1;
			if (failures === 1) throw new TypeError("offline");
			return new Response(superjson.stringify(payload([service()])), { status: 200 });
		}) as typeof fetch;
		const store = new MlRegistryStore(fetcher);

		store.watch("conv-1", { live: true });
		await flush();
		expect(store.loaded).toBe(false);
		await vi.advanceTimersByTimeAsync(ML_REGISTRY_POLL_MS);
		expect(store.loaded).toBe(true);
	});
});

describe("mlRegistry store: file versions and content", () => {
	const listing = (version: number): MlFileVersionListing => ({
		version,
		size: 9,
		origin: version === 1 ? "write" : "edit",
		createdAt: new Date(version),
	});

	function fileServer(files: Record<string, string[]>) {
		const calls: string[] = [];
		let failing = false;
		let suspended: Array<() => void> | undefined;
		const fetcher = (async (input: RequestInfo | URL) => {
			const url = new URL(String(input));
			calls.push(`${url.pathname}${url.search}`);
			const name = decodeURIComponent(url.pathname.split("/files/")[1] ?? "");
			const contents = files[name];
			const version = url.searchParams.get("version");
			const body = version
				? { name, ...listing(Number(version)), content: contents?.[Number(version) - 1] }
				: { name, versions: (contents ?? []).map((_, i) => listing(i + 1)).reverse() };
			if (suspended) await new Promise<void>((resolve) => suspended?.push(resolve));
			if (failing) throw new TypeError("offline");
			if (!contents) return new Response("{}", { status: 404 });
			return new Response(superjson.stringify(body), { status: 200 });
		}) as typeof fetch;
		return {
			fetcher,
			calls,
			fail: (value: boolean) => (failing = value),
			suspend: () => (suspended = []),
			release: () => {
				const waiting = suspended ?? [];
				suspended = undefined;
				waiting.forEach((resume) => resume());
			},
		};
	}

	function bound(server: ReturnType<typeof fileServer>, latest: Record<string, number>) {
		const store = new MlRegistryStore(server.fetcher);
		store.bind("conv-1");
		store.apply({
			...payload(),
			files: Object.entries(latest).map(([name, version]) => ({
				name,
				version,
				size: 9,
				updatedAt: new Date(0),
			})),
		});
		return store;
	}

	it("fetches a file's versions once, and again only when the registry lists a newer one", async () => {
		const table = { "train.py": ["a", "b"] };
		const server = fileServer(table);
		const store = bound(server, { "train.py": 2 });

		const first = store.loadFileVersions("train.py");
		expect(store.fileVersions("train.py")).toEqual({ status: "loading" });
		await first;
		await store.loadFileVersions("train.py");

		expect(server.calls).toEqual(["/api/v2/conversations/conv-1/files/train.py"]);
		expect(store.fileVersions("train.py")).toEqual({
			status: "ready",
			value: [listing(2), listing(1)],
		});

		table["train.py"].push("c");
		store.apply({
			...payload(),
			files: [{ name: "train.py", version: 3, size: 9, updatedAt: new Date(0) }],
		});
		const refetch = store.loadFileVersions("train.py");
		expect(store.fileVersions("train.py")?.status).toBe("ready");
		await refetch;

		expect(server.calls).toHaveLength(2);
		const versions = store.fileVersions("train.py");
		expect(versions?.status === "ready" && versions.value.map((v) => v.version)).toEqual([3, 2, 1]);
	});

	it("asks again when a poll lists a newer version while an older answer is in flight", async () => {
		const table = { "train.py": ["a", "b"] };
		const server = fileServer(table);
		const store = bound(server, { "train.py": 2 });

		server.suspend();
		const first = store.loadFileVersions("train.py");
		table["train.py"].push("c");
		store.apply({
			...payload(),
			files: [{ name: "train.py", version: 3, size: 9, updatedAt: new Date(0) }],
		});
		const coalesced = store.loadFileVersions("train.py");
		server.release();
		await Promise.all([first, coalesced]);

		expect(server.calls).toHaveLength(2);
		const versions = store.fileVersions("train.py");
		expect(versions?.status === "ready" && versions.value.map((v) => v.version)).toEqual([3, 2, 1]);
	});

	it("fetches each version's content once, by version, and never with the registry poll", async () => {
		const server = fileServer({ "configs/sft.yaml": ["lr: 1\n", "lr: 2\n"] });
		const store = bound(server, { "configs/sft.yaml": 2 });

		await Promise.all([
			store.loadFileContent("configs/sft.yaml", 2),
			store.loadFileContent("configs/sft.yaml", 2),
		]);
		await store.loadFileContent("configs/sft.yaml", 1);
		await store.loadFileContent("configs/sft.yaml", 2);

		expect(server.calls).toEqual([
			"/api/v2/conversations/conv-1/files/configs/sft.yaml?version=2",
			"/api/v2/conversations/conv-1/files/configs/sft.yaml?version=1",
		]);
		expect(store.fileContent("configs/sft.yaml", 2)).toEqual({ status: "ready", value: "lr: 2\n" });
		expect(store.fileContent("configs/sft.yaml", 1)).toEqual({ status: "ready", value: "lr: 1\n" });
		expect(store.fileContent("configs/sft.yaml", 3)).toBeUndefined();
	});

	it("marks a failed load and asks again when told to", async () => {
		const server = fileServer({ "train.py": ["a"] });
		const store = bound(server, { "train.py": 1 });
		server.fail(true);

		await store.loadFileVersions("train.py");
		await store.loadFileContent("train.py", 1);
		expect(store.fileVersions("train.py")).toEqual({ status: "error" });
		expect(store.fileContent("train.py", 1)).toEqual({ status: "error" });

		server.fail(false);
		await store.loadFileContent("train.py", 1);
		expect(store.fileContent("train.py", 1)).toEqual({ status: "ready", value: "a" });
	});

	it("forgets the cache on reset and drops an answer that lands after it", async () => {
		const server = fileServer({ "train.py": ["a"] });
		const store = bound(server, { "train.py": 1 });
		await store.loadFileContent("train.py", 1);

		server.suspend();
		const late = store.loadFileVersions("train.py");
		store.reset();
		store.bind("conv-2");
		server.release();
		await late;

		expect(store.fileContent("train.py", 1)).toBeUndefined();
		expect(store.fileVersions("train.py")).toBeUndefined();
	});
});

describe("mlRegistry store: sub-agent run details", () => {
	const detail = (
		{ taskPreview: _taskPreview, ...run }: MlRegistryAgentRun,
		callCount = run.callCount
	): MlAgentRunDetail => ({
		...run,
		callCount,
		task: "Context: x\n\nResearch task: find recipes",
		calls: Array.from({ length: callCount }, (_, i) => ({
			tool: "hf_fs",
			args: `{"i":${i}}`,
			status: "success" as const,
		})),
	});

	function runServer(answer: () => MlAgentRunDetail | undefined) {
		const calls: string[] = [];
		let suspended: Array<() => void> | undefined;
		const fetcher = (async (input: RequestInfo | URL) => {
			calls.push(new URL(String(input)).pathname);
			const body = answer();
			if (suspended) await new Promise<void>((resolve) => suspended?.push(resolve));
			if (!body) return new Response("{}", { status: 404 });
			return new Response(superjson.stringify(body), { status: 200 });
		}) as typeof fetch;
		return {
			fetcher,
			calls,
			suspend: () => (suspended = []),
			release: () => {
				const waiting = suspended ?? [];
				suspended = undefined;
				waiting.forEach((resume) => resume());
			},
		};
	}

	it("fetches a run once, and again only once the listing shows it moved on", async () => {
		let current = agentRun();
		const server = runServer(() => detail(current));
		const store = new MlRegistryStore(server.fetcher);
		store.bind("conv-1");
		store.apply({ ...payload(), agentRuns: [current] });

		const first = store.loadRunDetail("run-1");
		expect(store.runDetail("run-1")).toEqual({ status: "loading" });
		await first;
		await store.loadRunDetail("run-1");
		expect(server.calls).toEqual(["/api/v2/conversations/conv-1/runs/run-1"]);
		const loaded = store.runDetail("run-1");
		expect(loaded?.status === "ready" && loaded.value.calls).toHaveLength(2);

		current = agentRun({ status: "completed", callCount: 3, endedAt: new Date(1) });
		store.apply({ ...payload(), agentRuns: [current] });
		const refetch = store.loadRunDetail("run-1");
		expect(store.runDetail("run-1")?.status).toBe("ready");
		await refetch;

		expect(server.calls).toHaveLength(2);
		const updated = store.runDetail("run-1");
		expect(updated?.status === "ready" && updated.value.status).toBe("completed");
	});

	it("asks again when a poll moves the run on while an older answer is in flight", async () => {
		let current = agentRun();
		const server = runServer(() => detail(current));
		const store = new MlRegistryStore(server.fetcher);
		store.bind("conv-1");
		store.apply({ ...payload(), agentRuns: [current] });

		server.suspend();
		const first = store.loadRunDetail("run-1");
		current = agentRun({ callCount: 5, iterations: 3 });
		store.apply({ ...payload(), agentRuns: [current] });
		const coalesced = store.loadRunDetail("run-1");
		server.release();
		await Promise.all([first, coalesced]);

		expect(server.calls).toHaveLength(2);
		const loaded = store.runDetail("run-1");
		expect(loaded?.status === "ready" && loaded.value.callCount).toBe(5);
	});

	it("marks a failed load, and forgets details on reset", async () => {
		const server = runServer(() => undefined);
		const store = new MlRegistryStore(server.fetcher);
		store.bind("conv-1");
		store.apply({ ...payload(), agentRuns: [agentRun()] });

		await store.loadRunDetail("run-1");
		expect(store.runDetail("run-1")).toEqual({ status: "error" });

		store.reset();
		expect(store.runDetail("run-1")).toBeUndefined();
	});
});
