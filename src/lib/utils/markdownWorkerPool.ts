import { browser } from "$app/environment";
import MarkdownWorker from "$lib/workers/markdownWorker?worker";
import { fallbackBlocks, processBlocks, type BlockToken } from "$lib/utils/marked";

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

interface InFlight {
	requestId: number;
	clientId: number;
	content: string;
	worker: Worker;
	onResult: ResultCallback;
	cancelled: boolean;
}

// The full markdown pipeline (katex + highlight.js + marked + DOMPurify) is loaded into
// every worker's JS VM, so the pool is deliberately tiny: a couple of workers shared
// across every MarkdownRenderer instance, instead of one worker per message. The old
// per-instance design spawned hundreds of worker VMs in a long thread, which exhausted
// mobile WebKit's ~2 GB per-tab renderer memory cap and got the tab jetsam-killed.
const POOL_SIZE = browser ? Math.max(1, Math.min(2, (navigator.hardwareConcurrency || 2) - 1)) : 0;

const hasWorkerSupport = browser && typeof Worker !== "undefined";

// Flips permanently to true if the Worker constructor throws (strict CSP `worker-src`,
// sandboxed iframe, Safari Lockdown Mode, quota denial) or if workers keep dying on
// startup. `typeof Worker !== "undefined"` only proves the global exists, not that
// construction succeeds, so we also need this runtime guard. Once set, every render
// degrades to the async main-thread path instead of going silent on the fallback.
let workersBroken = false;
const canUseWorker = () => hasWorkerSupport && !workersBroken;

// A worker that dies before ever replying triggers a recreate; cap how many times in a
// row that can happen before we give up on workers entirely (avoids a recreate storm if
// the worker module itself fails to initialize). Reset on any successful reply.
const MAX_CONSECUTIVE_DEATHS = 3;
let consecutiveDeaths = 0;

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
const inFlight = new Map<number, InFlight>();
// Clients currently occupying a worker. Used to serialize per client so a newer request
// never races ahead of (or runs concurrently with) the one already in flight.
const inFlightClients = new Set<number>();

function runOnMainThread(job: {
	content: string;
	sources: Source[];
	streaming: boolean;
	requestId: number;
	onResult: ResultCallback;
}) {
	void processBlocks(job.content, job.sources, job.streaming)
		.then((blocks) => job.onResult(blocks, job.requestId))
		// Symmetry with the worker path ("never go silent"): on a parse error still
		// resolve the render with the lightweight fallback instead of leaking an
		// unhandled rejection and stranding the renderer on escaped plaintext.
		.catch(() => job.onResult(fallbackBlocks(job.content), job.requestId));
}

// Workers became unavailable: flush everything still queued to the main-thread path so no
// render is left stranded.
function drainToMainThread() {
	for (const job of pending.values()) runOnMainThread(job);
	pending.clear();
	queue.length = 0;
	queued.clear();
}

function ensureWorker() {
	if (idle.length > 0 || createdWorkers >= POOL_SIZE) return;
	let worker: Worker;
	try {
		worker = new MarkdownWorker();
	} catch {
		// Construction itself failed (CSP / Lockdown Mode / sandbox). Give up on workers
		// for the session and degrade gracefully.
		workersBroken = true;
		drainToMainThread();
		return;
	}
	worker.onmessage = (event: MessageEvent) => onWorkerMessage(worker, event);
	worker.onerror = () => handleWorkerDeath(worker);
	worker.onmessageerror = () => handleWorkerDeath(worker);
	createdWorkers++;
	idle.push(worker);
}

// Detach a worker from the pool, freeing its slot so a replacement can be created. Returns
// the in-flight entries that were attached to it for the caller to resolve or discard.
function dropWorker(worker: Worker): InFlight[] {
	const i = idle.indexOf(worker);
	if (i !== -1) idle.splice(i, 1);
	if (createdWorkers > 0) createdWorkers--;
	const orphaned: InFlight[] = [];
	for (const entry of inFlight.values()) {
		if (entry.worker === worker) orphaned.push(entry);
	}
	for (const entry of orphaned) {
		inFlight.delete(entry.requestId);
		inFlightClients.delete(entry.clientId);
	}
	return orphaned;
}

// A worker crashed without replying (top-level error, structured-clone messageerror, or
// the OS reclaiming it). Don't strand its render or wedge the pool: deliver the fallback,
// free the slot, and retry queued work on a fresh worker.
function handleWorkerDeath(worker: Worker) {
	worker.onmessage = null;
	worker.onerror = null;
	worker.onmessageerror = null;
	const orphaned = dropWorker(worker);
	worker.terminate();
	for (const entry of orphaned) {
		if (!entry.cancelled) entry.onResult(fallbackBlocks(entry.content), entry.requestId);
	}
	consecutiveDeaths++;
	if (consecutiveDeaths >= MAX_CONSECUTIVE_DEATHS) {
		workersBroken = true;
		drainToMainThread();
		return;
	}
	pump();
}

function onWorkerMessage(worker: Worker, event: MessageEvent) {
	const data = event.data as { type?: string; blocks?: BlockToken[]; requestId?: number };
	if (data?.type !== "processed" || data.requestId === undefined) return;

	consecutiveDeaths = 0;
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
		if (idle.length === 0) return; // every worker busy and pool at capacity (or broken)
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
		inFlight.set(job.requestId, {
			requestId: job.requestId,
			clientId,
			content: job.content,
			worker,
			onResult: job.onResult,
			cancelled: false,
		});
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
 * available (SSR, no Worker support, or workers that failed at runtime).
 */
export function renderMarkdownBlocks(
	clientId: number,
	content: string,
	sources: Source[],
	streaming: boolean,
	onResult: ResultCallback
): number {
	const requestId = nextRequestId++;

	if (!canUseWorker()) {
		runOnMainThread({ content, sources, streaming, requestId, onResult });
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

	// If a render is already running for this client, abort it: the component is gone, so
	// terminate its worker (truly stopping the obsolete parse, rather than letting it hold
	// a scarce pool slot) and free the slot. A fresh worker is created lazily on the next
	// pump for whatever view is now active. At most one in-flight job per client (renders
	// are serialized per client), so this terminates at most one worker.
	let abortedWorker: Worker | undefined;
	for (const entry of inFlight.values()) {
		if (entry.clientId === clientId) {
			entry.cancelled = true;
			abortedWorker = entry.worker;
			break;
		}
	}
	if (abortedWorker) {
		abortedWorker.onmessage = null;
		abortedWorker.onerror = null;
		abortedWorker.onmessageerror = null;
		dropWorker(abortedWorker);
		abortedWorker.terminate();
		pump();
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
		broken: () => workersBroken,
	};
}
