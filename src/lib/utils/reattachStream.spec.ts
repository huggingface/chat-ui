import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageUpdateType, type MessageUpdate } from "$lib/types/MessageUpdate";
import { CAUGHT_UP, reattachStream, type ReattachFrame } from "./reattachStream";

class FakeEventSource extends EventTarget {
	static last: FakeEventSource | undefined;
	closed = false;
	constructor(readonly url: string) {
		super();
		FakeEventSource.last = this;
	}
	close() {
		this.closed = true;
	}
	emit(type: string, data = "") {
		this.dispatchEvent(new MessageEvent(type, { data }));
	}
}

const text = (token: string): MessageUpdate => ({ type: MessageUpdateType.Stream, token });

describe("reattachStream", () => {
	beforeEach(() => {
		vi.stubGlobal("EventSource", FakeEventSource);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		FakeEventSource.last = undefined;
	});

	it("yields the caughtUp marker in order, and ignores events it does not know", async () => {
		const frames = reattachStream("http://localhost/stream", new AbortController().signal);
		const first = frames.next();
		const source = FakeEventSource.last;
		if (!source) throw new Error("EventSource was not opened");

		source.emit("update", JSON.stringify(text("replayed")));
		source.emit("caughtUp");
		source.emit("heartbeat");
		source.emit("update", JSON.stringify(text("live")));
		source.emit("end", JSON.stringify({ status: "completed" }));

		const received: ReattachFrame[] = [];
		for (let next = await first; !next.done; next = await frames.next()) {
			received.push(next.value);
		}

		expect(received).toEqual([text("replayed"), CAUGHT_UP, text("live")]);
		expect(source.closed).toBe(true);
	});
});
