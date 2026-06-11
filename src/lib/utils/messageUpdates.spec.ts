import { describe, expect, it } from "vitest";
import {
	MessageUpdateStatus,
	MessageUpdateType,
	type MessageUpdate,
} from "$lib/types/MessageUpdate";
import { applyStreamingMode, resolveStreamingMode, smoothStreamUpdates } from "./messageUpdates";

async function* fromArray<T>(values: T[]): AsyncGenerator<T> {
	for (const value of values) {
		yield value;
	}
}

async function collect(iter: AsyncGenerator<MessageUpdate>) {
	const updates: MessageUpdate[] = [];
	for await (const update of iter) {
		updates.push(update);
	}
	return updates;
}

const streamText = (updates: MessageUpdate[]) =>
	updates
		.filter((u) => u.type === MessageUpdateType.Stream)
		.map((u) => u.token)
		.join("");

describe("smoothStreamUpdates", () => {
	it("merges partial words and preserves final text", async () => {
		const source: MessageUpdate[] = [
			{ type: MessageUpdateType.Stream, token: "Hel" },
			{ type: MessageUpdateType.Stream, token: "lo " },
			{ type: MessageUpdateType.Stream, token: "wor" },
			{ type: MessageUpdateType.Stream, token: "ld!" },
			{ type: MessageUpdateType.Status, status: MessageUpdateStatus.Finished },
		];

		const updates = await collect(
			smoothStreamUpdates(fromArray(source), {
				minDelayMs: 0,
				maxDelayMs: 0,
				_internal: { detectChunk: (buffer) => /\S+\s+/.exec(buffer)?.[0] ?? null },
			})
		);

		const streamedChunks = updates.filter((u) => u.type === MessageUpdateType.Stream);
		expect(streamedChunks.map((u) => u.token)).toEqual(["Hello ", "world!"]);
		expect(streamText(updates)).toBe("Hello world!");
	});

	it("flushes buffered stream text before in-flow updates", async () => {
		const source: MessageUpdate[] = [
			{ type: MessageUpdateType.Stream, token: "hello" },
			{ type: MessageUpdateType.Stream, token: " world" },
			{ type: MessageUpdateType.Status, status: MessageUpdateStatus.Finished },
		];

		const updates = await collect(
			smoothStreamUpdates(fromArray(source), { minDelayMs: 0, maxDelayMs: 0 })
		);
		expect(updates[0]).toMatchObject({ type: MessageUpdateType.Stream });
		expect(updates[1]).toMatchObject({ type: MessageUpdateType.Stream });
		expect(updates[2]).toEqual({
			type: MessageUpdateType.Status,
			status: MessageUpdateStatus.Finished,
		});
		expect(streamText(updates)).toBe("hello world");
	});

	it("passes out-of-band updates through without splitting words", async () => {
		const source: MessageUpdate[] = [
			{ type: MessageUpdateType.Stream, token: "hel" },
			{ type: MessageUpdateType.Title, title: "My conversation" },
			{ type: MessageUpdateType.RouterMetadata, route: "casual", model: "some-model" },
			{ type: MessageUpdateType.Stream, token: "lo" },
			{ type: MessageUpdateType.Status, status: MessageUpdateStatus.Finished },
		];

		const updates = await collect(
			smoothStreamUpdates(fromArray(source), { minDelayMs: 0, maxDelayMs: 0 })
		);

		const chunks = updates.filter((u) => u.type === MessageUpdateType.Stream).map((u) => u.token);
		// Title and router metadata render outside the message text; they must
		// not force "hel" out as its own fragment.
		expect(chunks).toEqual(["hello"]);
		expect(updates.some((u) => u.type === MessageUpdateType.Title)).toBe(true);
		expect(updates.some((u) => u.type === MessageUpdateType.RouterMetadata)).toBe(true);
	});

	it("spreads burst tokens over time", async () => {
		const bigToken = "word ".repeat(40); // 200 chars, 40 words
		const source: MessageUpdate[] = [{ type: MessageUpdateType.Stream, token: bigToken }];
		let nowMs = 0;
		const emitTimes: number[] = [];

		const iter = smoothStreamUpdates(fromArray(source), {
			minDelayMs: 5,
			maxDelayMs: 80,
			minRateCharsPerMs: 0.3,
			_internal: {
				now: () => nowMs,
				sleep: async (ms: number) => {
					nowMs += ms;
				},
				detectChunk: (buffer) => /\S+\s+/.exec(buffer)?.[0] ?? null,
			},
		});

		for await (const update of iter) {
			if (update.type === MessageUpdateType.Stream) {
				emitTimes.push(nowMs);
			}
		}

		// Should have multiple emissions
		expect(emitTimes.length).toBeGreaterThan(5);
		// Gap between first and last emission should be significant (not instant dump)
		const totalSpread = (emitTimes.at(-1) ?? 0) - (emitTimes[0] ?? 0);
		expect(totalSpread).toBeGreaterThan(100);
	});

	it("keeps delays within configured bounds", async () => {
		const source: MessageUpdate[] = [
			{
				type: MessageUpdateType.Stream,
				token: "one two three four five six seven eight nine ten ",
			},
		];
		const delays: number[] = [];
		let nowMs = 0;

		await collect(
			smoothStreamUpdates(fromArray(source), {
				minDelayMs: 5,
				maxDelayMs: 80,
				minRateCharsPerMs: 0.3,
				_internal: {
					now: () => nowMs,
					sleep: async (ms: number) => {
						delays.push(ms);
						nowMs += ms;
					},
					detectChunk: (buffer) => /\S+\s+/.exec(buffer)?.[0] ?? null,
				},
			})
		);

		expect(delays.length).toBeGreaterThan(2);
		expect(delays.every((d) => d >= 5 && d <= 80)).toBe(true);
	});

	it("handles CJK text correctly", async () => {
		const source: MessageUpdate[] = [{ type: MessageUpdateType.Stream, token: "你好，世界！" }];

		const updates = await collect(
			smoothStreamUpdates(fromArray(source), { minDelayMs: 0, maxDelayMs: 0 })
		);

		expect(streamText(updates)).toBe("你好，世界！");
	});

	it("propagates source errors to consumer", async () => {
		async function* failingSource(): AsyncGenerator<MessageUpdate> {
			yield { type: MessageUpdateType.Stream, token: "hello " };
			throw new Error("source failed");
		}

		await expect(
			collect(smoothStreamUpdates(failingSource(), { minDelayMs: 0, maxDelayMs: 0 }))
		).rejects.toThrow("source failed");
	});

	it("propagates source errors even when no full chunk was emitted yet", async () => {
		async function* failingSource(): AsyncGenerator<MessageUpdate> {
			yield { type: MessageUpdateType.Stream, token: "hel" };
			throw new Error("source failed");
		}

		await expect(
			collect(
				smoothStreamUpdates(failingSource(), {
					minDelayMs: 0,
					maxDelayMs: 0,
					_internal: { detectChunk: (buffer) => /\S+\s+/.exec(buffer)?.[0] ?? null },
				})
			)
		).rejects.toThrow("source failed");
	});

	it("drains queued stream chunks before throwing source errors", async () => {
		async function* failingSource(): AsyncGenerator<MessageUpdate> {
			yield { type: MessageUpdateType.Stream, token: "a " };
			yield { type: MessageUpdateType.Stream, token: "b " };
			yield { type: MessageUpdateType.Stream, token: "c " };
			throw new Error("source failed");
		}

		const seen: MessageUpdate[] = [];
		let seenError: Error | null = null;
		try {
			for await (const update of smoothStreamUpdates(failingSource(), {
				minDelayMs: 0,
				maxDelayMs: 0,
				_internal: { detectChunk: (buffer) => /\S+\s+/.exec(buffer)?.[0] ?? null },
			})) {
				seen.push(update);
			}
		} catch (error) {
			seenError = error as Error;
		}

		expect(streamText(seen)).toBe("a b c ");
		expect(seenError?.message).toBe("source failed");
	});

	it("caps burst tail latency with backlog acceleration", async () => {
		const source: MessageUpdate[] = [
			{ type: MessageUpdateType.Stream, token: "word ".repeat(500) },
		];
		let nowMs = 0;
		await collect(
			smoothStreamUpdates(fromArray(source), {
				minDelayMs: 5,
				maxDelayMs: 80,
				minRateCharsPerMs: 0.3,
				maxBufferedMs: 400,
				_internal: {
					now: () => nowMs,
					sleep: async (ms: number) => {
						nowMs += ms;
					},
					detectChunk: (buffer) => /\S+\s+/.exec(buffer)?.[0] ?? null,
				},
			})
		);

		// Everything queued at t=0 must finish draining by ~maxBufferedMs.
		expect(nowMs).toBeLessThanOrEqual(450);
	});

	it("skips empty tokens gracefully", async () => {
		const source: MessageUpdate[] = [
			{ type: MessageUpdateType.Stream, token: "" },
			{ type: MessageUpdateType.Stream, token: "hello " },
			{ type: MessageUpdateType.Stream, token: "" },
			{ type: MessageUpdateType.Stream, token: "world!" },
			{ type: MessageUpdateType.Status, status: MessageUpdateStatus.Finished },
		];

		const updates = await collect(
			smoothStreamUpdates(fromArray(source), { minDelayMs: 0, maxDelayMs: 0 })
		);
		expect(streamText(updates)).toBe("hello world!");
	});

	it("does not split words on keep-alive updates", async () => {
		const source: MessageUpdate[] = [
			{ type: MessageUpdateType.Stream, token: "hel" },
			{ type: MessageUpdateType.Status, status: MessageUpdateStatus.KeepAlive },
			{ type: MessageUpdateType.Stream, token: "lo" },
			{ type: MessageUpdateType.Status, status: MessageUpdateStatus.Finished },
		];

		const updates = await collect(
			smoothStreamUpdates(fromArray(source), { minDelayMs: 0, maxDelayMs: 0 })
		);

		const chunks = updates.filter((u) => u.type === MessageUpdateType.Stream).map((u) => u.token);
		// The keep-alive between the two halves must not flush "hel" on its own.
		expect(chunks).toEqual(["hello"]);
	});

	it("emits CJK text at word-level cadence", async () => {
		const text = "这是一个关于人工智能的长篇讨论，模型逐字输出中文内容。";
		const source: MessageUpdate[] = [{ type: MessageUpdateType.Stream, token: text }];

		const updates = await collect(
			smoothStreamUpdates(fromArray(source), { minDelayMs: 0, maxDelayMs: 0 })
		);

		const chunks = updates.filter((u) => u.type === MessageUpdateType.Stream);
		// CJK has no spaces; words must still stream out incrementally rather
		// than waiting for punctuation or end of stream.
		expect(chunks.length).toBeGreaterThan(5);
		expect(streamText(updates)).toBe(text);
	});

	it("keeps emitting through boundary-less text (hashes, base64)", async () => {
		const blob = "QmFzZTY0RGF0YQ".repeat(30); // 420 chars, no word boundaries
		const tokens = blob.match(/.{1,60}/g) ?? [];
		const source: MessageUpdate[] = tokens.map((token) => ({
			type: MessageUpdateType.Stream,
			token,
		}));

		const updates = await collect(
			smoothStreamUpdates(fromArray(source), { minDelayMs: 0, maxDelayMs: 0 })
		);

		const chunks = updates.filter((u) => u.type === MessageUpdateType.Stream);
		// Without the pending-buffer cap this would be held until stream end
		// and dumped as a single chunk.
		expect(chunks.length).toBeGreaterThan(3);
		expect(streamText(updates)).toBe(blob);
	});

	it("closes the source iterator when the consumer stops early", async () => {
		let closed = false;
		async function* source(): AsyncGenerator<MessageUpdate> {
			try {
				yield { type: MessageUpdateType.Stream, token: "a " };
				yield { type: MessageUpdateType.Stream, token: "b " };
				yield { type: MessageUpdateType.Stream, token: "c " };
			} finally {
				closed = true;
			}
		}

		const iter = smoothStreamUpdates(source(), { minDelayMs: 0, maxDelayMs: 0 });
		await iter.next();
		await iter.return(undefined);
		await new Promise((resolve) => setImmediate(resolve));

		expect(closed).toBe(true);
	});
});

/**
 * Deterministic virtual clock: drives the smoother and a timed source from the
 * same simulated timeline so emission timing can be asserted exactly.
 */
function createVirtualClock() {
	let nowMs = 0;
	let seq = 0;
	const timers: Array<{ at: number; seq: number; resolve: () => void }> = [];
	const sleep = (ms: number) =>
		new Promise<void>((resolve) => {
			timers.push({ at: nowMs + Math.max(0, ms), seq: seq++, resolve });
		});
	const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
	const run = async <T>(promise: Promise<T>): Promise<T> => {
		let settled = false;
		promise.then(
			() => (settled = true),
			() => (settled = true)
		);
		let idleTicks = 0;
		while (!settled) {
			await tick();
			if (settled) break;
			if (timers.length === 0) {
				if (++idleTicks > 20) throw new Error(`virtual clock stalled at t=${nowMs}ms`);
				continue;
			}
			idleTicks = 0;
			timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
			const timer = timers.shift();
			if (!timer) continue;
			nowMs = Math.max(nowMs, timer.at);
			timer.resolve();
		}
		return promise;
	};
	return { now: () => nowMs, sleep, run };
}

type Clock = ReturnType<typeof createVirtualClock>;
type TimedEvent = { at: number; update: MessageUpdate };

async function* timedSource(events: TimedEvent[], clock: Clock): AsyncGenerator<MessageUpdate> {
	for (const event of events) {
		const wait = event.at - clock.now();
		if (wait > 0) await clock.sleep(wait);
		yield event.update;
	}
}

async function collectTimed(events: TimedEvent[], clock: Clock) {
	const emitted: Array<{ at: number; token: string }> = [];
	await clock.run(
		(async () => {
			const iter = smoothStreamUpdates(timedSource(events, clock), {
				_internal: { now: clock.now, sleep: clock.sleep },
			});
			for await (const update of iter) {
				if (update.type === MessageUpdateType.Stream) {
					emitted.push({ at: clock.now(), token: update.token });
				}
			}
		})()
	);
	return emitted;
}

describe("smoothStreamUpdates timing", () => {
	const word = (at: number, token = "lorem "): TimedEvent => ({
		at,
		update: { type: MessageUpdateType.Stream, token },
	});

	it("shows the first word the moment it arrives", async () => {
		const clock = createVirtualClock();
		const emitted = await collectTimed([word(0, "Hello "), word(30, "world ")], clock);

		expect(emitted[0]).toMatchObject({ at: 0, token: "Hello " });
	});

	it("adds no latency to streams slower than the pacing floor", async () => {
		const clock = createVirtualClock();
		const events = Array.from({ length: 10 }, (_, i) => word(i * 100));
		const emitted = await collectTimed(events, clock);

		// Each word renders exactly when it arrives; pacing reservations
		// (~20ms per word at the floor rate) are absorbed by the 100ms gaps.
		expect(emitted.map((e) => e.at)).toEqual(events.map((e) => e.at));
	});

	it("spreads a large single burst evenly until the buffered deadline", async () => {
		const clock = createVirtualClock();
		const emitted = await collectTimed([word(0, "lorem ".repeat(300))], clock);

		expect(emitted.length).toBe(300);
		// Drains close to (and never far past) the 400ms default budget.
		const last = emitted.at(-1)?.at ?? 0;
		expect(last).toBeGreaterThan(300);
		expect(last).toBeLessThanOrEqual(450);
		// Linear spread: no large rendering gap while a backlog exists.
		let maxGap = 0;
		for (let i = 1; i < emitted.length; i++) {
			maxGap = Math.max(maxGap, emitted[i].at - emitted[i - 1].at);
		}
		expect(maxGap).toBeLessThanOrEqual(25);
	});

	it("never holds a chunk more than maxBufferedMs past its arrival", async () => {
		const clock = createVirtualClock();
		// Fast provider: 60 chars every 10ms (~6000 cps) for 300ms.
		const events = Array.from({ length: 30 }, (_, i) => word(i * 10, "lorem ".repeat(10)));

		const arrivals: Array<{ endIndex: number; at: number }> = [];
		let total = 0;
		for (const e of events) {
			if (e.update.type === MessageUpdateType.Stream) {
				total += e.update.token.length;
				arrivals.push({ endIndex: total, at: e.at });
			}
		}
		const arrivedAt = (charIndex: number) => arrivals.find((a) => charIndex < a.endIndex)?.at ?? 0;

		const emitted = await collectTimed(events, clock);
		let emittedChars = 0;
		for (const e of emitted) {
			const lastChar = emittedChars + e.token.length - 1;
			expect(e.at - arrivedAt(lastChar)).toBeLessThanOrEqual(410);
			emittedChars += e.token.length;
		}
		expect(emittedChars).toBe(total);
	});

	it("recovers promptly after a mid-stream stall", async () => {
		const clock = createVirtualClock();
		const events = [
			...Array.from({ length: 5 }, (_, i) => word(i * 30)),
			// 2s stall, then the stream resumes.
			...Array.from({ length: 5 }, (_, i) => word(2000 + i * 30)),
		];
		const emitted = await collectTimed(events, clock);

		const firstAfterStall = emitted.find((e) => e.at >= 2000);
		expect(firstAfterStall?.at).toBe(2000);
		expect(emitted.length).toBe(10);
	});
});

describe("applyStreamingMode", () => {
	it("keeps stream unchanged for raw mode", async () => {
		const source: MessageUpdate[] = [
			{ type: MessageUpdateType.Stream, token: "Hello" },
			{ type: MessageUpdateType.Status, status: MessageUpdateStatus.Finished },
		];

		const raw = await collect(applyStreamingMode(fromArray(source), "raw"));

		expect(raw).toEqual(source);
	});
});

describe("resolveStreamingMode", () => {
	it("returns explicit streamingMode when set", () => {
		expect(resolveStreamingMode({ streamingMode: "raw" })).toBe("raw");
		expect(resolveStreamingMode({ streamingMode: "smooth" })).toBe("smooth");
	});

	it("defaults to smooth when unset", () => {
		expect(resolveStreamingMode({})).toBe("smooth");
	});

	it("maps unsupported legacy values to smooth", () => {
		expect(resolveStreamingMode({ streamingMode: "final" })).toBe("smooth");
	});
});
