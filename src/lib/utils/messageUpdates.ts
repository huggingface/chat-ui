import type { MessageFile } from "$lib/types/Message";
import {
	type MessageUpdate,
	type MessageToolUpdate,
	type MessageToolCallUpdate,
	type MessageToolResultUpdate,
	type MessageToolErrorUpdate,
	type MessageToolProgressUpdate,
	MessageUpdateType,
	MessageUpdateStatus,
	MessageToolUpdateType,
} from "$lib/types/MessageUpdate";
import type { StreamingMode } from "$lib/types/Settings";
import type { KeyValuePair } from "$lib/types/Tool";

type MessageUpdateRequestOptions = {
	base: string;
	inputs?: string;
	messageId?: string;
	isRetry: boolean;
	isContinue?: boolean;
	// Client-chosen id for this generation run, echoed back by stop-generating
	// so the server can match a stop point to the run it belongs to
	generationId?: string;
	files?: MessageFile[];
	// Optional: pass selected MCP server names (client-side selection)
	selectedMcpServerNames?: string[];
	// Optional: pass selected MCP server configs (for custom client-defined servers)
	selectedMcpServers?: Array<{ name: string; url: string; headers?: KeyValuePair[] }>;
	// User's IANA timezone (e.g. "America/New_York")
	timezone?: string;
	streamingMode?: StreamingMode;
	// Spoken conversation turn (voice mode): the server pins the generation to
	// the voice provider and swaps in the voice system prompt
	voiceMode?: boolean;
};

type ChunkDetector = (buffer: string) => string | null;

type SmoothStreamConfig = {
	minDelayMs?: number;
	maxDelayMs?: number;
	minRateCharsPerMs?: number;
	maxBufferedMs?: number;
	_internal?: {
		now?: () => number;
		sleep?: (ms: number) => Promise<void>;
		detectChunk?: ChunkDetector;
	};
};

export async function fetchMessageUpdates(
	conversationId: string,
	opts: MessageUpdateRequestOptions,
	abortSignal: AbortSignal
): Promise<AsyncGenerator<MessageUpdate>> {
	const abortController = new AbortController();
	abortSignal.addEventListener("abort", () => abortController.abort());

	const form = new FormData();

	const optsJSON = JSON.stringify({
		inputs: opts.inputs,
		id: opts.messageId,
		is_retry: opts.isRetry,
		is_continue: Boolean(opts.isContinue),
		generationId: opts.generationId,
		// Will be ignored server-side if unsupported
		selectedMcpServerNames: opts.selectedMcpServerNames,
		selectedMcpServers: opts.selectedMcpServers,
		timezone: opts.timezone,
		voiceMode: opts.voiceMode,
	});

	opts.files?.forEach((file) => {
		const name = file.type + ";" + file.name;

		form.append("files", new File([file.value], name, { type: file.mime }));
	});

	form.append("data", optsJSON);

	const response = await fetch(`${opts.base}/conversation/${conversationId}`, {
		method: "POST",
		body: form,
		signal: abortController.signal,
	});

	if (!response.ok) {
		const errorMessage = await response
			.json()
			.then((obj) => obj.message)
			.catch(() => `Request failed with status code ${response.status}: ${response.statusText}`);
		throw Error(errorMessage);
	}
	if (!response.body) {
		throw Error("Body not defined");
	}

	return applyStreamingMode(
		endpointStreamToIterator(response, abortController),
		opts.streamingMode ?? "smooth"
	);
}

export function applyStreamingMode(
	iterator: AsyncGenerator<MessageUpdate>,
	streamingMode: StreamingMode
): AsyncGenerator<MessageUpdate> {
	if (streamingMode === "smooth") {
		return smoothStreamUpdates(iterator);
	}

	// "raw" keeps source stream intact.
	return iterator;
}

export function resolveStreamingMode(s: { streamingMode?: unknown }): StreamingMode {
	return s.streamingMode === "raw" || s.streamingMode === "smooth" ? s.streamingMode : "smooth";
}

async function* endpointStreamToIterator(
	response: Response,
	abortController: AbortController
): AsyncGenerator<MessageUpdate> {
	const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader();
	if (!reader) throw Error("Response for endpoint had no body");

	// Handle any cases where we must abort
	reader.closed.then(() => abortController.abort());

	// Handle logic for aborting
	abortController.signal.addEventListener("abort", () => reader.cancel());

	// ex) If the last response is => {"type": "stream", "token":
	// It should be => {"type": "stream", "token": "Hello"} = prev_input_chunk + "Hello"}
	let prevChunk = "";
	while (!abortController.signal.aborted) {
		const { done, value } = await reader.read();
		if (done) {
			abortController.abort();
			break;
		}
		if (!value) continue;

		const { messageUpdates, remainingText } = parseMessageUpdates(prevChunk + value);
		prevChunk = remainingText;
		for (const messageUpdate of messageUpdates) yield messageUpdate;
	}
}

function parseMessageUpdates(value: string): {
	messageUpdates: MessageUpdate[];
	remainingText: string;
} {
	const inputs = value.split("\n");
	const messageUpdates: MessageUpdate[] = [];
	for (const input of inputs) {
		try {
			messageUpdates.push(JSON.parse(input) as MessageUpdate);
		} catch (error) {
			// in case of parsing error, we return what we were able to parse
			if (error instanceof SyntaxError) {
				return {
					messageUpdates,
					remainingText: inputs.at(-1) ?? "",
				};
			}
		}
	}
	return { messageUpdates, remainingText: "" };
}

/** Time constant for the arrival-rate estimate: reacts within ~1s to pace changes. */
const ARRIVAL_RATE_TAU_MS = 1000;
/** Pace slightly above the estimated arrival rate so the queue trends empty. */
const ARRIVAL_RATE_HEADROOM = 1.1;
/** Boundary-less runs (hashes, base64, CJK without Intl.Segmenter) flush at this size. */
const MAX_PENDING_CHARS = 64;

export async function* smoothStreamUpdates(
	iterator: AsyncGenerator<MessageUpdate>,
	{
		minDelayMs = 5,
		maxDelayMs = 80,
		minRateCharsPerMs = 0.3,
		maxBufferedMs = 400,
		_internal: { now = () => performance.now(), sleep = defaultSleep, detectChunk } = {},
	}: SmoothStreamConfig = {}
): AsyncGenerator<MessageUpdate> {
	const chunkDetector = detectChunk ?? createWordChunkDetector();
	const queue: Array<{ update: MessageUpdate; arrivedAt: number }> = [];
	let queuedStreamChars = 0;
	let producerDone = false;
	let producerError: unknown = null;
	let pendingBuffer = "";

	let wakeConsumer: (() => void) | null = null;
	const wake = () => {
		wakeConsumer?.();
		wakeConsumer = null;
	};
	const nextWake = () =>
		new Promise<void>((resolve) => {
			wakeConsumer = resolve;
		});

	// Exponentially-decayed estimate of the source arrival rate (chars/ms).
	// Pacing the output at the rate text actually arrives keeps the cadence
	// steady through network burstiness instead of draining fast and freezing.
	let arrivalAcc = 0;
	let arrivalAt: number | null = null;
	const observeArrival = (chars: number) => {
		const t = now();
		if (arrivalAt !== null) arrivalAcc *= Math.exp((arrivalAt - t) / ARRIVAL_RATE_TAU_MS);
		arrivalAcc += chars;
		arrivalAt = t;
	};
	const arrivalRate = () =>
		arrivalAt === null
			? 0
			: (arrivalAcc * Math.exp((arrivalAt - now()) / ARRIVAL_RATE_TAU_MS)) / ARRIVAL_RATE_TAU_MS;

	const enqueue = (update: MessageUpdate) => {
		if (update.type === MessageUpdateType.Stream) {
			queuedStreamChars += update.token.length;
		}
		queue.push({ update, arrivedAt: now() });
		wake();
	};

	const flushPendingBuffer = () => {
		if (pendingBuffer.length === 0) return;
		enqueue({ type: MessageUpdateType.Stream, token: pendingBuffer });
		pendingBuffer = "";
	};

	// Updates rendered outside the message text flow (liveness pings, the
	// conversation title, the routed-model badge). They pass through without
	// flushing a partially-buffered word; anything else flushes first so text
	// never appears cut short next to tool/status/final updates.
	const isOutOfBand = (update: MessageUpdate): boolean =>
		update.type === MessageUpdateType.Title ||
		update.type === MessageUpdateType.RouterMetadata ||
		(update.type === MessageUpdateType.Status && update.status === MessageUpdateStatus.KeepAlive);

	const producer = (async () => {
		for await (const messageUpdate of iterator) {
			if (messageUpdate.type !== MessageUpdateType.Stream) {
				if (!isOutOfBand(messageUpdate)) flushPendingBuffer();
				enqueue(messageUpdate);
				continue;
			}

			if (!messageUpdate.token) continue;

			observeArrival(messageUpdate.token.length);
			pendingBuffer += messageUpdate.token;
			let chunk: string | null;
			while ((chunk = chunkDetector(pendingBuffer)) !== null && chunk.length > 0) {
				enqueue({ type: MessageUpdateType.Stream, token: chunk });
				pendingBuffer = pendingBuffer.slice(chunk.length);
			}
			if (pendingBuffer.length >= MAX_PENDING_CHARS) flushPendingBuffer();
		}
		flushPendingBuffer();
	})()
		.catch((error) => {
			producerError = error;
		})
		.finally(() => {
			producerDone = true;
			wake();
		});

	// Pacing: after emitting a chunk, reserve `chunkLen / targetRate` ms before
	// the next chunk may appear. A source slower than the target is never
	// delayed (its own gaps exceed the reservation, so the first word and every
	// word of a slow stream render the moment they arrive); a faster source is
	// spread out evenly. No chunk is ever held more than maxBufferedMs past its
	// arrival, and the catch-up rate drains a backlog linearly by that deadline
	// rather than dumping it all at once.
	let nextEmitAt = 0;
	try {
		for (;;) {
			const entry = queue.shift();
			if (!entry) {
				if (producerDone) break;
				await nextWake();
				continue;
			}

			const { update } = entry;
			if (update.type !== MessageUpdateType.Stream) {
				yield update;
				continue;
			}

			const deadline = maxBufferedMs > 0 ? entry.arrivedAt + maxBufferedMs : Infinity;
			const waitMs = Math.round(Math.min(nextEmitAt, deadline) - now());
			if (waitMs > 0) await sleep(waitMs);

			queuedStreamChars -= update.token.length;
			yield update;

			const catchUpRate = maxBufferedMs > 0 ? queuedStreamChars / Math.max(1, deadline - now()) : 0;
			const targetRate = Math.max(
				arrivalRate() * ARRIVAL_RATE_HEADROOM,
				minRateCharsPerMs,
				catchUpRate
			);
			const effectiveMinDelayMs = catchUpRate > minRateCharsPerMs ? 0 : minDelayMs;
			const spacingMs = Math.max(
				effectiveMinDelayMs,
				Math.min(maxDelayMs, update.token.length / targetRate)
			);
			nextEmitAt = now() + spacingMs;
		}

		await producer;
		if (producerError) throw producerError;
	} finally {
		// Stop pulling from the source if our consumer stops early.
		void iterator.return(undefined);
	}
}

function createWordChunkDetector(): ChunkDetector {
	if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
		const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
		return (buffer: string): string | null => {
			if (buffer.length === 0) return null;
			let sawWord = false;

			for (const part of segmenter.segment(buffer)) {
				if (!sawWord) {
					sawWord = Boolean(part.isWordLike);
					continue;
				}
				// A new word begins right after the previous one: split before it.
				// This is what gives word-level cadence to CJK text, which has no
				// whitespace between words.
				if (part.isWordLike) return buffer.slice(0, part.index);
				// Whitespace is always a safe split point: split after it.
				if (/\s/.test(part.segment)) return buffer.slice(0, part.index + part.segment.length);
				// Trailing punctuation stays attached to the word before it.
			}

			return null;
		};
	}

	const wordWithTrailingBoundary = /\S+\s+/m;
	return (buffer: string): string | null => {
		const match = wordWithTrailingBoundary.exec(buffer);
		if (!match) return null;
		return buffer.slice(0, match.index) + match[0];
	};
}

// Tool update type guards for UI rendering
export const isMessageToolUpdate = (update: MessageUpdate): update is MessageToolUpdate =>
	update.type === MessageUpdateType.Tool;

export const isMessageToolCallUpdate = (update: MessageUpdate): update is MessageToolCallUpdate =>
	isMessageToolUpdate(update) && update.subtype === MessageToolUpdateType.Call;

export const isMessageToolResultUpdate = (
	update: MessageUpdate
): update is MessageToolResultUpdate =>
	isMessageToolUpdate(update) && update.subtype === MessageToolUpdateType.Result;

export const isMessageToolErrorUpdate = (update: MessageUpdate): update is MessageToolErrorUpdate =>
	isMessageToolUpdate(update) && update.subtype === MessageToolUpdateType.Error;

export const isMessageToolProgressUpdate = (
	update: MessageUpdate
): update is MessageToolProgressUpdate =>
	isMessageToolUpdate(update) && update.subtype === MessageToolUpdateType.Progress;

const defaultSleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));
