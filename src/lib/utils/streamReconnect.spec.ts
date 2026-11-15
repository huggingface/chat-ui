import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { Message } from "$lib/types/Message";
import { MessageUpdateType, type MessageUpdate } from "$lib/types/MessageUpdate";
import type { TurnStatus } from "$lib/types/TurnState";
import {
	isTransportFailure,
	reconnectAction,
	reconnectBackoffMs,
	waitUntilReachable,
} from "./streamReconnect";

const turnState = (state: TurnStatus): MessageUpdate => ({
	type: MessageUpdateType.TurnState,
	state,
	serverNow: 0,
});

function assistant(overrides: Partial<Message> = {}): Message {
	return {
		from: "assistant",
		id: "assistant-1" as Message["id"],
		content: "",
		children: [],
		generationId: "gen-1",
		updates: [turnState("running")],
		...overrides,
	};
}

const idle = { writeInFlight: false, subscribed: false, resyncing: false };

describe("reconnectAction", () => {
	test("replaces the connection of a held subscription", () => {
		expect(reconnectAction({ ...idle, lastAssistant: assistant(), subscribed: true })).toBe(
			"resubscribe"
		);
	});

	test.each<TurnStatus>(["running", "waiting", "awaiting_input"])(
		"resyncs a %s turn that has no subscription",
		(state) => {
			const lastAssistant = assistant({ updates: [turnState(state)] });
			expect(reconnectAction({ ...idle, lastAssistant })).toBe("resync");
		}
	);

	test.each<TurnStatus>(["done", "failed"])("never reconnects a %s turn", (state) => {
		const lastAssistant = assistant({ updates: [turnState(state)] });
		expect(reconnectAction({ ...idle, lastAssistant })).toBe("none");
		expect(reconnectAction({ ...idle, lastAssistant, subscribed: true })).toBe("none");
	});

	test("never reconnects an interrupted turn", () => {
		const lastAssistant = assistant({ interrupted: true });
		expect(reconnectAction({ ...idle, lastAssistant })).toBe("none");
	});

	test("leaves the turn to the POST stream that is still writing it", () => {
		expect(
			reconnectAction({
				lastAssistant: assistant(),
				writeInFlight: true,
				subscribed: false,
				resyncing: true,
			})
		).toBe("none");
	});

	test("does nothing without an assistant message or a generation to subscribe to", () => {
		expect(reconnectAction({ ...idle, lastAssistant: undefined })).toBe("none");
		expect(
			reconnectAction({ ...idle, lastAssistant: assistant({ generationId: undefined }) })
		).toBe("none");
	});

	test("hurries a resync that is backing off, even for a local placeholder message", () => {
		const placeholder = assistant({ generationId: undefined, updates: [] });
		expect(reconnectAction({ ...idle, lastAssistant: placeholder, resyncing: true })).toBe(
			"resync"
		);
	});

	test("prefers the held subscription over a resync still winding down", () => {
		expect(
			reconnectAction({
				lastAssistant: assistant(),
				writeInFlight: false,
				subscribed: true,
				resyncing: true,
			})
		).toBe("resubscribe");
	});
});

describe("reconnectBackoffMs", () => {
	test("doubles from one second and caps at thirty", () => {
		expect([0, 1, 2, 3, 4, 5, 6, 7, 20].map(reconnectBackoffMs)).toEqual([
			0, 1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000,
		]);
	});
});

describe("isTransportFailure", () => {
	test("is true only for the TypeError fetch rejects with when the connection fails", () => {
		expect(isTransportFailure(new TypeError("Failed to fetch"))).toBe(true);
		expect(isTransportFailure(new TypeError("Load failed"))).toBe(true);
	});

	test("is false for HTTP errors, aborts, and non-errors", () => {
		expect(isTransportFailure(new Error("Request failed with status code 429"))).toBe(false);
		expect(isTransportFailure(new DOMException("aborted", "AbortError"))).toBe(false);
		expect(isTransportFailure("Failed to fetch")).toBe(false);
		expect(isTransportFailure(undefined)).toBe(false);
	});
});

describe("waitUntilReachable", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const never = () => new Promise<boolean>(() => {});

	test("probes immediately and resolves true on the first success", async () => {
		const probe = vi.fn(async () => true);
		const { done } = waitUntilReachable({ probe, signal: new AbortController().signal });

		await expect(done).resolves.toBe(true);
		expect(probe).toHaveBeenCalledTimes(1);
	});

	test("waits the initial delay, then backs off 1s, 2s, 4s between failures", async () => {
		const calls: number[] = [];
		const probe = vi.fn(async () => {
			calls.push(Date.now());
			return calls.length === 4;
		});
		const start = Date.now();
		const { done } = waitUntilReachable({
			probe,
			signal: new AbortController().signal,
			initialDelayMs: 500,
		});

		await vi.advanceTimersByTimeAsync(60_000);

		await expect(done).resolves.toBe(true);
		expect(calls.map((at) => at - start)).toEqual([500, 1_500, 3_500, 7_500]);
	});

	test("treats a rejected probe as a failure, not a crash", async () => {
		const probe = vi
			.fn<(signal: AbortSignal) => Promise<boolean>>()
			.mockRejectedValueOnce(new TypeError("Failed to fetch"))
			.mockResolvedValueOnce(true);
		const { done } = waitUntilReachable({ probe, signal: new AbortController().signal });

		await vi.advanceTimersByTimeAsync(1_000);

		await expect(done).resolves.toBe(true);
		expect(probe).toHaveBeenCalledTimes(2);
	});

	test("gives up on a probe that hangs, aborts it, and carries on to the next", async () => {
		const signals: AbortSignal[] = [];
		const probe = vi.fn((signal: AbortSignal) => {
			signals.push(signal);
			return signals.length === 1 ? never() : Promise.resolve(true);
		});
		const { done } = waitUntilReachable({
			probe,
			signal: new AbortController().signal,
			probeTimeoutMs: 10_000,
		});

		await vi.advanceTimersByTimeAsync(9_999);
		expect(signals[0].aborted).toBe(false);
		expect(probe).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(1);
		expect(signals[0].aborted).toBe(true);

		await vi.advanceTimersByTimeAsync(1_000);
		await expect(done).resolves.toBe(true);
		expect(probe).toHaveBeenCalledTimes(2);
	});

	test("abort during a backoff resolves false without probing again", async () => {
		const controller = new AbortController();
		const probe = vi.fn(async () => false);
		const { done } = waitUntilReachable({ probe, signal: controller.signal });

		await vi.advanceTimersByTimeAsync(500);
		controller.abort();

		await expect(done).resolves.toBe(false);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(probe).toHaveBeenCalledTimes(1);
	});

	test("abort during a hanging probe resolves false at once and aborts the request", async () => {
		const controller = new AbortController();
		let probeSignal: AbortSignal | undefined;
		const probe = vi.fn((signal: AbortSignal) => {
			probeSignal = signal;
			return never();
		});
		const { done } = waitUntilReachable({ probe, signal: controller.signal });

		await vi.advanceTimersByTimeAsync(100);
		controller.abort();

		await expect(done).resolves.toBe(false);
		expect(probeSignal?.aborted).toBe(true);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(probe).toHaveBeenCalledTimes(1);
	});

	test("a probe that succeeds after an abort still resolves false", async () => {
		const controller = new AbortController();
		let succeed: (value: boolean) => void = () => {};
		const probe = vi.fn(() => new Promise<boolean>((resolve) => (succeed = resolve)));
		const { done } = waitUntilReachable({ probe, signal: controller.signal });

		controller.abort();
		succeed(true);

		await expect(done).resolves.toBe(false);
	});

	test("retryNow() cuts a backoff short", async () => {
		const calls: number[] = [];
		const probe = vi.fn(async () => {
			calls.push(Date.now());
			return calls.length === 2;
		});
		const start = Date.now();
		const { done, retryNow } = waitUntilReachable({
			probe,
			signal: new AbortController().signal,
			initialDelayMs: 30_000,
		});

		await vi.advanceTimersByTimeAsync(200);
		retryNow();
		await vi.advanceTimersByTimeAsync(300);
		retryNow();

		await expect(done).resolves.toBe(true);
		expect(calls.map((at) => at - start)).toEqual([200, 500]);
	});

	test("retryNow() abandons a hanging probe and retries without a backoff", async () => {
		const signals: AbortSignal[] = [];
		const probe = vi.fn((signal: AbortSignal) => {
			signals.push(signal);
			return signals.length === 1 ? never() : Promise.resolve(true);
		});
		const { done, retryNow } = waitUntilReachable({
			probe,
			signal: new AbortController().signal,
		});

		await vi.advanceTimersByTimeAsync(3_000);
		retryNow();

		await expect(done).resolves.toBe(true);
		expect(signals[0].aborted).toBe(true);
		expect(probe).toHaveBeenCalledTimes(2);
	});
});
