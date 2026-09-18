import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { MessageUpdateType, type MessageUpdate } from "$lib/types/MessageUpdate";
import { ReattachClosedError, reattachStream } from "./reattachStream";

type Listener = (event: unknown) => void;

class FakeEventSource {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSED = 2;
	static instances: FakeEventSource[] = [];

	readonly url: URL;
	readyState = FakeEventSource.CONNECTING;
	private listeners = new Map<string, Set<Listener>>();

	constructor(url: string | URL) {
		this.url = new URL(url);
		FakeEventSource.instances.push(this);
	}

	addEventListener(type: string, listener: Listener) {
		const set = this.listeners.get(type) ?? new Set<Listener>();
		set.add(listener);
		this.listeners.set(type, set);
	}

	close() {
		this.readyState = FakeEventSource.CLOSED;
	}

	emit(type: string, event: Record<string, unknown> = {}) {
		for (const listener of this.listeners.get(type) ?? []) listener(event);
	}

	open() {
		this.readyState = FakeEventSource.OPEN;
		this.emit("open");
	}

	update(seq: number, token: string) {
		const update: MessageUpdate = { type: MessageUpdateType.Stream, token };
		this.emit("update", { data: JSON.stringify(update), lastEventId: String(seq) });
	}

	get fromSeq() {
		return this.url.searchParams.get("fromSeq");
	}
}

const URL_FROM_5 = "https://chat.test/conversation/abc/stream?messageId=m1&fromSeq=5";

const sources = () => FakeEventSource.instances;
const latest = () => {
	const source = sources().at(-1);
	if (!source) throw new Error("no EventSource was created");
	return source;
};

async function tokenOf(next: Promise<IteratorResult<MessageUpdate>>): Promise<string | undefined> {
	const { value, done } = await next;
	if (done) return undefined;
	return value.type === MessageUpdateType.Stream ? value.token : `<${value.type}>`;
}

describe("reattachStream", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		FakeEventSource.instances = [];
		vi.stubGlobal("EventSource", FakeEventSource);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	test("yields update frames and stops on end without reconnecting", async () => {
		const { updates } = reattachStream(URL_FROM_5, new AbortController().signal);

		const first = updates.next();
		latest().open();
		latest().update(6, "Hello");
		expect(await tokenOf(first)).toBe("Hello");

		const second = updates.next();
		latest().emit("end", { data: JSON.stringify({ status: "completed" }) });
		expect((await second).done).toBe(true);
		expect(latest().readyState).toBe(FakeEventSource.CLOSED);

		await vi.advanceTimersByTimeAsync(60_000);
		expect(sources()).toHaveLength(1);
	});

	test("a named heartbeat is never yielded as a MessageUpdate", async () => {
		const { updates } = reattachStream(URL_FROM_5, new AbortController().signal);

		const first = updates.next();
		latest().open();
		latest().emit("heartbeat", { data: "{}", lastEventId: "5" });
		latest().emit("heartbeat", { data: "{}", lastEventId: "5" });
		latest().update(6, "after");

		expect(await tokenOf(first)).toBe("after");
	});

	test("re-subscribes from the last delivered sequence after 10s of silence", async () => {
		const { updates } = reattachStream(URL_FROM_5, new AbortController().signal);

		const first = updates.next();
		const original = latest();
		original.open();
		original.update(6, "a");
		original.update(7, "b");
		expect(await tokenOf(first)).toBe("a");
		expect(await tokenOf(updates.next())).toBe("b");

		const pending = updates.next();
		await vi.advanceTimersByTimeAsync(9_999);
		expect(sources()).toHaveLength(1);

		await vi.advanceTimersByTimeAsync(1);
		expect(sources()).toHaveLength(2);
		expect(original.readyState).toBe(FakeEventSource.CLOSED);
		expect(latest().fromSeq).toBe("7");
		expect(latest().url.searchParams.get("messageId")).toBe("m1");

		latest().open();
		latest().update(8, "c");
		expect(await tokenOf(pending)).toBe("c");
	});

	test("heartbeats keep an idle connection from being treated as stalled", async () => {
		const { updates } = reattachStream(URL_FROM_5, new AbortController().signal);
		void updates.next();
		latest().open();

		for (let elapsed = 0; elapsed < 60_000; elapsed += 5_000) {
			await vi.advanceTimersByTimeAsync(5_000);
			latest().emit("heartbeat", { data: "{}" });
		}

		expect(sources()).toHaveLength(1);
	});

	test("keeps re-subscribing while the silence lasts", async () => {
		const { updates } = reattachStream(URL_FROM_5, new AbortController().signal);
		void updates.next();

		await vi.advanceTimersByTimeAsync(30_000);

		expect(sources()).toHaveLength(4);
		expect(sources().filter((s) => s.readyState !== FakeEventSource.CLOSED)).toHaveLength(1);
	});

	test("drops a replayed sequence and frames from a superseded connection", async () => {
		const { updates } = reattachStream(URL_FROM_5, new AbortController().signal);

		const first = updates.next();
		const original = latest();
		original.update(6, "a");
		expect(await tokenOf(first)).toBe("a");

		const pending = updates.next();
		await vi.advanceTimersByTimeAsync(10_000);
		expect(sources()).toHaveLength(2);

		original.update(7, "from the dead connection");
		latest().update(6, "replayed");
		latest().update(7, "b");

		expect(await tokenOf(pending)).toBe("b");
	});

	test("surfaces a CLOSED connection as an error after draining what arrived", async () => {
		const { updates } = reattachStream(URL_FROM_5, new AbortController().signal);

		const first = updates.next();
		latest().open();
		latest().update(6, "a");
		latest().update(7, "b");
		latest().readyState = FakeEventSource.CLOSED;
		latest().emit("error");

		expect(await tokenOf(first)).toBe("a");
		expect(await tokenOf(updates.next())).toBe("b");
		const failure = await updates.next().catch((err: unknown) => err);
		expect(failure).toBeInstanceOf(ReattachClosedError);
		expect((failure as ReattachClosedError).opened).toBe(true);

		await vi.advanceTimersByTimeAsync(60_000);
		expect(sources()).toHaveLength(1);
	});

	test("reports a connection that was refused before it ever opened", async () => {
		const { updates } = reattachStream(URL_FROM_5, new AbortController().signal);

		const first = updates.next();
		latest().readyState = FakeEventSource.CLOSED;
		latest().emit("error");

		const failure = await first.catch((err: unknown) => err);
		expect(failure).toBeInstanceOf(ReattachClosedError);
		expect((failure as ReattachClosedError).opened).toBe(false);
	});

	test("leaves a CONNECTING error to the browser's own retry", async () => {
		const { updates } = reattachStream(URL_FROM_5, new AbortController().signal);

		const first = updates.next();
		latest().open();
		latest().readyState = FakeEventSource.CONNECTING;
		latest().emit("error");
		latest().update(6, "after the native retry");

		expect(await tokenOf(first)).toBe("after the native retry");
		expect(sources()).toHaveLength(1);
	});

	test("resubscribe() replaces the connection in place, from the last sequence", async () => {
		const { updates, resubscribe } = reattachStream(URL_FROM_5, new AbortController().signal);

		const first = updates.next();
		const original = latest();
		original.update(6, "a");
		expect(await tokenOf(first)).toBe("a");

		const pending = updates.next();
		await vi.advanceTimersByTimeAsync(2_000);
		resubscribe();

		expect(sources()).toHaveLength(2);
		expect(original.readyState).toBe(FakeEventSource.CLOSED);
		expect(latest().fromSeq).toBe("6");

		latest().update(7, "b");
		expect(await tokenOf(pending)).toBe("b");

		await vi.advanceTimersByTimeAsync(9_999);
		expect(sources()).toHaveLength(2);
	});

	test("resubscribe() is ignored right after a connect, before start, and after the end", async () => {
		const { updates, resubscribe } = reattachStream(URL_FROM_5, new AbortController().signal);

		resubscribe();
		expect(sources()).toHaveLength(0);

		const first = updates.next();
		resubscribe();
		expect(sources()).toHaveLength(1);

		latest().emit("end");
		await first;
		await vi.advanceTimersByTimeAsync(5_000);
		resubscribe();
		expect(sources()).toHaveLength(1);
	});

	test("abort ends the stream quietly and stops the watchdog", async () => {
		const controller = new AbortController();
		const { updates } = reattachStream(URL_FROM_5, controller.signal);

		const first = updates.next();
		controller.abort();

		expect((await first).done).toBe(true);
		expect(latest().readyState).toBe(FakeEventSource.CLOSED);

		await vi.advanceTimersByTimeAsync(60_000);
		expect(sources()).toHaveLength(1);
	});

	test("an already-aborted signal never connects", async () => {
		const controller = new AbortController();
		controller.abort();
		const { updates } = reattachStream(URL_FROM_5, controller.signal);

		expect((await updates.next()).done).toBe(true);
		expect(sources()).toHaveLength(0);
	});
});
