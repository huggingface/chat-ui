import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import superjson from "superjson";
import type { MlRegistryPayload, MlRegistryService } from "$lib/types/MlRegistry";

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
		net.answer(payload([service()]));
		const store = new MlRegistryStore(net.fetcher);

		store.watch("conv-1", { live: false });
		await flush();

		expect(net.calls).toEqual(["http://localhost:5173/api/v2/conversations/conv-1/registry"]);
		expect(store.conversationId).toBe("conv-1");
		expect(store.loaded).toBe(true);
		expect(store.services).toHaveLength(1);
		expect(store.services[0].createdAt).toBeInstanceOf(Date);
		expect(store.summary).toEqual({ rows: 1, open: 1, running: 1 });
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
