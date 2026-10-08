import LiveWatcherHost from "./__tests__/LiveWatcherHost.svelte";
import { render } from "vitest-browser-svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Stands in for the browser's EventSource, so a test can drive the feed. */
class FakeEventSource {
	static CONNECTING = 0;
	static OPEN = 1;
	static CLOSED = 2;
	static instances: FakeEventSource[] = [];
	readyState = FakeEventSource.OPEN;
	listeners = new Map<string, Array<(event: MessageEvent) => void>>();
	constructor(public url: string) {
		FakeEventSource.instances.push(this);
	}
	addEventListener(type: string, fn: (event: MessageEvent) => void) {
		this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
	}
	close() {
		this.readyState = FakeEventSource.CLOSED;
	}
	emit(type: string, data?: unknown) {
		const event = new MessageEvent(type, { data: JSON.stringify(data ?? {}) });
		for (const fn of this.listeners.get(type) ?? []) fn(event);
	}
	/** A failed response: the browser closes the source for good. */
	fail() {
		this.readyState = FakeEventSource.CLOSED;
		this.emit("error");
	}
}

const sync = (parked: Array<{ conversationId: string; status: string }>) => ({
	running: [],
	ended: [],
	parked,
});

beforeEach(() => {
	FakeEventSource.instances = [];
	vi.stubGlobal("EventSource", FakeEventSource);
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("GenerationLiveWatcher", () => {
	it("reopens a feed the browser gave up on while a turn is still parked", async () => {
		let store: { statusFor(id: string): string | undefined } | undefined;
		render(LiveWatcherHost, { onstore: (s) => (store = s) });
		const first = FakeEventSource.instances[0];
		first.emit("sync", sync([{ conversationId: "c1", status: "waiting" }]));
		expect(store?.statusFor("c1")).toBe("waiting");

		first.fail();
		await vi.advanceTimersByTimeAsync(3_000);

		expect(FakeEventSource.instances).toHaveLength(2);
		// The new feed is what reports the turn's later states.
		FakeEventSource.instances[1].emit(
			"sync",
			sync([{ conversationId: "c1", status: "awaiting_input" }])
		);
		expect(store?.statusFor("c1")).toBe("awaiting_input");
	});

	it("does not keep retrying a feed with nothing to follow", async () => {
		render(LiveWatcherHost, {});
		FakeEventSource.instances[0].fail();
		await vi.advanceTimersByTimeAsync(120_000);

		expect(FakeEventSource.instances).toHaveLength(1);
	});
});
