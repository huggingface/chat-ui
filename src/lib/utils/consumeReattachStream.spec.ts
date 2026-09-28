import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "$lib/types/Message";
import {
	MessageToolUpdateType,
	MessageUpdateType,
	type MessageUpdate,
} from "$lib/types/MessageUpdate";
import type { StreamingMode } from "$lib/types/Settings";
import { consumeMessageUpdates, type ConsumeContext } from "./consumeMessageUpdates";
import { CAUGHT_UP_WAIT_MS, consumeReattachStream } from "./consumeReattachStream";
import { applyStreamingMode } from "./messageUpdates";
import { CAUGHT_UP, type ReattachFrame } from "./reattachStream";

const text = (token: string): MessageUpdate => ({ type: MessageUpdateType.Stream, token });
const toolCall: MessageUpdate = {
	type: MessageUpdateType.Tool,
	subtype: MessageToolUpdateType.Call,
	uuid: "00000000-0000-4000-8000-000000000001",
	call: { name: "hf_jobs", parameters: {} },
};

const isUpdate = (frame: ReattachFrame): frame is MessageUpdate => frame !== CAUGHT_UP;

async function* fromArray<T>(values: T[]): AsyncGenerator<T> {
	yield* values;
}

/** A source the test feeds frame by frame, like the SSE connection does. */
function pushableFrames() {
	const queue: ReattachFrame[] = [];
	let ended = false;
	let wake: (() => void) | null = null;
	const notify = () => {
		wake?.();
		wake = null;
	};
	async function* iterate(): AsyncGenerator<ReattachFrame> {
		for (;;) {
			const next = queue.shift();
			if (next !== undefined) {
				yield next;
				continue;
			}
			if (ended) return;
			await new Promise<void>((resolve) => (wake = resolve));
		}
	}
	return {
		frames: iterate(),
		push(...frames: ReattachFrame[]) {
			queue.push(...frames);
			notify();
		},
		end() {
			ended = true;
			notify();
		},
	};
}

function context(streamingMode: StreamingMode) {
	const onStreamStart = vi.fn();
	const ctx: ConsumeContext = {
		streamingMode,
		maxUpdateTime: Number.POSITIVE_INFINITY,
		isAborted: () => false,
		onAbort: vi.fn(),
		onStreamStart,
		onTitle: vi.fn(),
		onError: vi.fn(),
	};
	return { ctx, onStreamStart };
}

// A reattached message as the page load delivers it: saved text, compressed to a length marker.
const SAVED = "saved text. ";
const savedMessage = (): Message => ({
	id: "00000000-0000-4000-8000-000000000000",
	from: "assistant",
	content: SAVED,
	updates: [{ type: MessageUpdateType.Stream, token: "", len: SAVED.length }],
});

/** What the same updates produce with no pacing anywhere. */
async function allRaw(frames: ReattachFrame[]): Promise<Message> {
	const message = savedMessage();
	await consumeMessageUpdates(fromArray(frames.filter(isUpdate)), message, context("raw").ctx);
	return message;
}

// setImmediate stays real: it lets every pending microtask run without moving the
// fake clock, so "rendered with no timer fired" is observable.
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("consumeReattachStream", () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("applies the backlog in one unpaced pass, then paces live updates", async () => {
		const source = pushableFrames();
		const message = savedMessage();
		const { ctx, onStreamStart } = context("smooth");
		const run = consumeReattachStream(source.frames, message, ctx);

		source.push(text("The quick brown "), toolCall, text("fox jumps "), text("over"));
		await settle();
		expect(message.content).toBe(SAVED);

		source.push(CAUGHT_UP);
		await settle();
		expect(message.content).toBe(SAVED + "The quick brown fox jumps over");
		expect(message.updates?.map((u) => u.type)).toEqual([
			MessageUpdateType.Stream,
			MessageUpdateType.Tool,
			MessageUpdateType.Stream,
		]);
		// One call per backlog token (smoothing would have re-chunked them into words),
		// and nothing left waiting on the clock: no sleep, no frame flush, no hold timer.
		expect(onStreamStart).toHaveBeenCalledTimes(3);
		expect(vi.getTimerCount()).toBe(0);

		source.push(text(" the lazy dog and keeps going"));
		await settle();
		expect(message.content).toBe(SAVED + "The quick brown fox jumps over");
		expect(vi.getTimerCount()).toBeGreaterThan(0);

		source.end();
		await vi.runAllTimersAsync();
		await run;
		expect(message.content).toBe(
			SAVED + "The quick brown fox jumps over the lazy dog and keeps going"
		);
		expect(onStreamStart.mock.calls.length).toBeGreaterThan(3 + 1);
	});

	it.each<StreamingMode>(["smooth", "raw"])(
		"renders the same text and updates as an all-raw run (%s)",
		async (streamingMode) => {
			// The marker lands mid-word, and a reconnect later sends a second one.
			const frames: ReattachFrame[] = [
				text("back"),
				toolCall,
				text("log hel"),
				CAUGHT_UP,
				text("lo wor"),
				text("ld, still "),
				CAUGHT_UP,
				text("streaming"),
				toolCall,
				text(" after the tool"),
			];
			const message = savedMessage();

			const run = consumeReattachStream(fromArray(frames), message, context(streamingMode).ctx);
			await vi.runAllTimersAsync();
			await run;

			const expected = await allRaw(frames);
			expect(message.content).toBe(expected.content);
			expect(message.content).toBe(SAVED + "backlog hello world, still streaming after the tool");
			expect(message.updates).toEqual(expected.updates);
		}
	);

	it("falls back to the configured mode when no marker arrives in time", async () => {
		const source = pushableFrames();
		const message = savedMessage();
		const { ctx, onStreamStart } = context("smooth");
		const run = consumeReattachStream(source.frames, message, ctx);

		source.push(text("alpha beta gamma "));
		await vi.advanceTimersByTimeAsync(CAUGHT_UP_WAIT_MS - 1);
		expect(message.content).toBe(SAVED);
		expect(onStreamStart).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);
		await vi.runAllTimersAsync();
		expect(message.content).toBe(SAVED + "alpha beta gamma ");
		// Word-sized chunks: the held update went through smoothing, not the raw pass.
		expect(onStreamStart).toHaveBeenCalledTimes(3);

		// The read that was in flight when the wait expired must not be lost, and a
		// marker that shows up late is dropped rather than rendered.
		source.push(text("delta"), CAUGHT_UP, text(" epsilon"));
		source.end();
		await vi.runAllTimersAsync();
		await run;
		expect(message.content).toBe(SAVED + "alpha beta gamma delta epsilon");
		expect(message.updates).toEqual(
			(await allRaw([text("alpha beta gamma delta epsilon")])).updates
		);
	});

	it("matches today's pipeline exactly when the stream ends without a marker", async () => {
		const updates = [text("one two "), toolCall, text("three four")];

		const message = savedMessage();
		const actual = context("smooth");
		const run = consumeReattachStream(fromArray<ReattachFrame>(updates), message, actual.ctx);
		await vi.runAllTimersAsync();
		await run;

		const reference = savedMessage();
		const expected = context("smooth");
		const referenceRun = consumeMessageUpdates(
			applyStreamingMode(fromArray(updates), "smooth"),
			reference,
			expected.ctx
		);
		await vi.runAllTimersAsync();
		await referenceRun;

		expect(message.content).toBe(reference.content);
		expect(message.updates).toEqual(reference.updates);
		expect(actual.onStreamStart.mock.calls.length).toBe(expected.onStreamStart.mock.calls.length);
	});

	it("delivers held updates before surfacing a source error", async () => {
		async function* failing(): AsyncGenerator<ReattachFrame> {
			yield text("kept");
			throw new Error("connection lost");
		}
		const { ctx, onStreamStart } = context("raw");

		await expect(consumeReattachStream(failing(), savedMessage(), ctx)).rejects.toThrow(
			"connection lost"
		);
		expect(onStreamStart).toHaveBeenCalledTimes(1);
	});
});
