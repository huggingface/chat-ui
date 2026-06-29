import { browser } from "$app/environment";
import MarkdownWorker from "$lib/workers/markdownWorker?worker";
import { processBlocks, type BlockToken } from "$lib/utils/marked";

type Source = { title?: string; link: string };
type ResultCallback = (blocks: BlockToken[], requestId: number) => void;

interface Job {
	clientId: number;
	requestId: number;
	content: string;
	sources: Source[];
	streaming: boolean;
	onResult: ResultCallback;
}

// The full markdown pipeline (katex + highlight.js + marked + DOMPurify) is loaded into
// every worker's JS VM, so the pool is deliberately tiny: a couple of workers shared
// across every MarkdownRenderer instance, instead of one worker per message. The old
// per-instance design spawned hundreds of worker VMs in a long thread, which exhausted
// mobile WebKit's ~2 GB per-tab renderer memory cap and got the tab jetsam-killed.
const POOL_SIZE = browser ? Math.max(1, Math.min(2, (navigator.hardwareConcurrency || 2) - 1)) : 0;

const canUseWorker = browser && typeof Worker !== "undefined";

let nextRequestId = 1;
let nextClientId = 1;

const idle: Worker[] = [];
let createdWorkers = 0;

// Latest queued job per client. Older queued jobs for the same client are coalesced away
// (only the most recent content matters), which keeps a fast-streaming message from
// flooding the pool with superseded work.
const pending = new Map<number, Job>();
const queue: number[] = [];
const queued = new Set<number>();

// Jobs handed to a worker and awaiting its reply, keyed by requestId.
const inFlight = new Map<
	number,
	{ clientId: number; onResult: ResultCallback; cancelled: boolean }
>();
// Clients currently occupying a worker. Used to serialize per client so a newer request
// never races ahead of (or runs concurrently with) the one already in flight.
const inFlightClients = new Set<number>();

function ensureWorker() {
	if (idle.length > 0 || createdWorkers >= POOL_SIZE) return;
	const worker = new MarkdownWorker();
	worker.onmessage = (event: MessageEvent) => onWorkerMessage(worker, event);
	createdWorkers++;
	idle.push(worker);
}

function onWorkerMessage(worker: Worker, event: MessageEvent) {
	const data = event.data as { type?: string; blocks?: BlockToken[]; requestId?: number };
	if (data?.type !== "processed" || data.requestId === undefined) return;

	idle.push(worker);
	const entry = inFlight.get(data.requestId);
	inFlight.delete(data.requestId);
	if (entry) {
		inFlightClients.delete(entry.clientId);
		if (!entry.cancelled) entry.onResult(data.blocks ?? [], data.requestId);
	}
	pump();
}

function pump() {
	while (queue.length > 0) {
		if (idle.length === 0) ensureWorker();
		if (idle.length === 0) return; // every worker busy and pool at capacity
		// First queued client that isn't already running (one job at a time per client).
		const idx = queue.findIndex((clientId) => !inFlightClients.has(clientId));
		if (idx === -1) return; // all waiting clients are mid-flight; wait for a reply
		const clientId = queue.splice(idx, 1)[0];
		queued.delete(clientId);
		const job = pending.get(clientId);
		pending.delete(clientId);
		if (!job) continue;

		const worker = idle.pop() as Worker;
		inFlightClients.add(clientId);
		inFlight.set(job.requestId, { clientId, onResult: job.onResult, cancelled: false });
		worker.postMessage({
			type: "process",
			content: job.content,
			sources: job.sources,
			requestId: job.requestId,
			streaming: job.streaming,
		});
	}
}

/** Stable id for one MarkdownRenderer instance, used to coalesce its successive renders. */
export function acquireMarkdownClientId(): number {
	return nextClientId++;
}

/**
 * Queue a markdown render for `clientId` on the shared worker pool. Returns the requestId;
 * the caller should treat only the highest requestId it has issued as current and ignore
 * late/stale callbacks. Falls back to async main-thread processing when workers aren't
 * available (SSR, or a browser without Worker support).
 */
export function renderMarkdownBlocks(
	clientId: number,
	content: string,
	sources: Source[],
	streaming: boolean,
	onResult: ResultCallback
): number {
	const requestId = nextRequestId++;

	if (!canUseWorker) {
		void processBlocks(content, sources, streaming).then((blocks) => onResult(blocks, requestId));
		return requestId;
	}

	pending.set(clientId, { clientId, requestId, content, sources, streaming, onResult });
	if (!queued.has(clientId)) {
		queued.add(clientId);
		queue.push(clientId);
	}
	pump();
	return requestId;
}

/** Drop any queued/in-flight work for a client that is going away (component destroyed). */
export function cancelMarkdownClient(clientId: number): void {
	pending.delete(clientId);
	if (queued.delete(clientId)) {
		const i = queue.indexOf(clientId);
		if (i !== -1) queue.splice(i, 1);
	}
	for (const entry of inFlight.values()) {
		if (entry.clientId === clientId) entry.cancelled = true;
	}
}

// Debug hook: read `__mdWorkerPool.workers()` in the console to confirm the live worker
// count stays at most POOL_SIZE regardless of conversation length. Before pooling, that
// count equaled the number of mounted MarkdownRenderer instances (hundreds in a long
// thread), which is what exhausted the mobile renderer's memory.
if (browser) {
	(globalThis as unknown as { __mdWorkerPool?: unknown }).__mdWorkerPool = {
		poolSize: POOL_SIZE,
		workers: () => createdWorkers,
		idle: () => idle.length,
		queued: () => queue.length,
		inFlight: () => inFlight.size,
	};
}
