import { afterEach, describe, expect, it, vi } from "vitest";
import {
	GRADIO_CONSOLE_PROTOCOL,
	createConsoleReceiver,
	type ConsoleEntry,
	type FrameConsoleState,
} from "./gradioConsole";
import { gradioConsoleFrameDoc, silentFrameDoc } from "./__fixtures__/gradioConsoleFrame";

type FrameWindow = Window & { console: Console; __inits: unknown[]; __sessionId?: string };

const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
	vi.useRealTimers();
});

/** a same origin srcdoc frame, which the fixture allowlists as localhost */
function mount(doc: string) {
	const iframe = document.createElement("iframe");
	const states: { state: FrameConsoleState; session?: string; version?: string }[] = [];
	const entries: ConsoleEntry[] = [];
	const receiver = createConsoleReceiver({
		frame: () => iframe.contentWindow,
		origin: location.origin,
		onState: (state, ack) =>
			states.push({ state, session: ack?.session_id, version: ack?.gradio_version }),
		onEntries: (fresh) => entries.push(...fresh),
	});
	const onMessage = (event: MessageEvent) => receiver.handleMessage(event);
	window.addEventListener("message", onMessage);
	const loaded = () =>
		new Promise<void>((resolve) =>
			iframe.addEventListener("load", () => resolve(), { once: true })
		);
	iframe.addEventListener("load", () => receiver.load());
	const first = loaded();
	iframe.srcdoc = doc;
	document.body.appendChild(iframe);
	cleanups.push(() => {
		window.removeEventListener("message", onMessage);
		receiver.dispose();
		iframe.remove();
	});
	const win = () => iframe.contentWindow as FrameWindow;
	return { iframe, receiver, states, entries, win, first, loaded };
}

const texts = (entries: ConsoleEntry[]) => entries.map((entry) => entry.text);

function speak(source: MessageEventSource | null, origin: string, data: unknown) {
	window.dispatchEvent(new MessageEvent("message", { data, origin, source }));
}

describe("gradio-console receiver against the fixture frame", () => {
	it("acks, flushes the buffer, then batches and dedupes", async () => {
		const frame = mount(
			gradioConsoleFrameDoc(
				{ gradioVersion: "6.31.0" },
				`console.log("boot", {a: 1}); console.error(new TypeError("x is undefined"));`
			)
		);
		await frame.first;
		await vi.waitFor(() => expect(frame.states.at(-1)?.state).toBe("connected"));
		expect(frame.states.at(-1)).toMatchObject({
			session: frame.win().__sessionId,
			version: "6.31.0",
		});
		await vi.waitFor(() => expect(frame.entries).toHaveLength(2));
		expect(texts(frame.entries)).toEqual(['boot {"a":1}', "TypeError: x is undefined"]);
		expect(frame.entries[1]).toMatchObject({ level: "error", seq: 2 });
		expect(frame.entries[1].stack).toContain("TypeError");

		frame.win().console.warn("later");
		await vi.waitFor(() => expect(texts(frame.entries)).toContain("later"));

		const acks = frame.states.length;
		frame.receiver.load();
		await vi.waitFor(() => expect(frame.win().__inits.length).toBeGreaterThanOrEqual(2));
		await new Promise((r) => setTimeout(r, 400));
		expect(frame.states.length).toBe(acks + 2);
		expect(texts(frame.entries)).toEqual(['boot {"a":1}', "TypeError: x is undefined", "later"]);
	});

	it("takes a first flush split across two messages", async () => {
		const frame = mount(
			gradioConsoleFrameDoc({}, `for (let i = 1; i <= 120; i++) console.log("line " + i);`)
		);
		await frame.first;
		await vi.waitFor(() => expect(frame.entries).toHaveLength(100));
		expect(frame.entries.map((e) => e.seq)).toEqual(Array.from({ length: 100 }, (_, i) => i + 21));
	});

	it("drops entries a frame sends again", async () => {
		const frame = mount(gradioConsoleFrameDoc({ mode: "replay" }, `console.log("once");`));
		await frame.first;
		await vi.waitFor(() => expect(frame.entries).toHaveLength(1));
		speak(frame.win(), location.origin, {
			protocol: GRADIO_CONSOLE_PROTOCOL,
			version: 1,
			type: "init",
		});
		frame.receiver.load();
		await vi.waitFor(() => expect(frame.win().__inits.length).toBeGreaterThanOrEqual(2));
		await new Promise((r) => setTimeout(r, 300));
		expect(texts(frame.entries)).toEqual(["once"]);
	});

	it("restarts the handshake on a reload and keeps the earlier page load's entries", async () => {
		const frame = mount(gradioConsoleFrameDoc({}, `console.log("load");`));
		await frame.first;
		await vi.waitFor(() => expect(frame.entries).toHaveLength(1));
		const firstSession = frame.win().__sessionId;

		const reloaded = frame.loaded();
		frame.win().location.reload();
		await reloaded;
		await vi.waitFor(() => expect(frame.entries).toHaveLength(2));
		const secondSession = frame.win().__sessionId;
		expect(secondSession).not.toBe(firstSession);
		expect(frame.states.map((s) => s.state)).toEqual([
			"connecting",
			"connected",
			"connecting",
			"connected",
		]);
		expect(frame.entries.map((e) => [e.session_id, e.seq])).toEqual([
			[firstSession, 1],
			[secondSession, 1],
		]);
	});
});

describe("gradio-console receiver with a frame that never answers", () => {
	it("retries init at 500, 1500 and 3000 ms, then marks it unsupported at 5 s", async () => {
		const frame = mount(silentFrameDoc());
		await frame.first;
		// the load listener already started a handshake on real timers
		await vi.waitFor(() => expect(frame.win().__inits).toHaveLength(1));
		frame.receiver.dispose();
		frame.win().__inits.length = 0;
		vi.useFakeTimers();
		frame.receiver.load();
		// vi.waitFor would advance the fake clock itself
		const yieldTask = () =>
			new Promise((resolve) => {
				const channel = new MessageChannel();
				channel.port1.onmessage = resolve;
				channel.port2.postMessage(0);
			});
		const inits = async (expected: number) => {
			for (let i = 0; i < 50 && frame.win().__inits.length < expected; i++) await yieldTask();
			for (let i = 0; i < 5; i++) await yieldTask();
			return frame.win().__inits.length;
		};
		expect(await inits(1)).toBe(1);
		vi.advanceTimersByTime(499);
		expect(await inits(2)).toBe(1);
		vi.advanceTimersByTime(1);
		expect(await inits(2)).toBe(2);
		vi.advanceTimersByTime(1000);
		expect(await inits(3)).toBe(3);
		vi.advanceTimersByTime(1500);
		expect(await inits(4)).toBe(4);
		expect(frame.win().__inits[0]).toEqual({
			protocol: "gradio-console",
			version: 1,
			type: "init",
		});
		vi.advanceTimersByTime(1999);
		expect(frame.states.at(-1)?.state).toBe("connecting");
		vi.advanceTimersByTime(1);
		expect(frame.states.at(-1)?.state).toBe("unsupported");
		vi.advanceTimersByTime(60_000);
		expect(await inits(5)).toBe(4);
	});
});

describe("gradio-console receiver message filtering", () => {
	const ack = (extra: Record<string, unknown> = {}) => ({
		protocol: GRADIO_CONSOLE_PROTOCOL,
		version: 1,
		type: "ack",
		session_id: "s1",
		gradio_version: "6.31.0",
		dropped: 0,
		...extra,
	});
	const entries = (seqs: number[], extra: Record<string, unknown> = {}) => ({
		protocol: GRADIO_CONSOLE_PROTOCOL,
		version: 1,
		type: "entries",
		session_id: "s1",
		dropped: 0,
		entries: seqs.map((seq) => ({ seq, ts: 1, level: "log", text: `e${seq}` })),
		...extra,
	});

	it("ignores the wrong source or origin", async () => {
		const frame = mount(silentFrameDoc());
		await frame.first;
		speak(window, location.origin, ack());
		speak(frame.win(), "https://evil.hf.space", ack());
		speak(frame.win(), location.origin.replace("localhost", "127.0.0.1"), ack());
		speak(window, location.origin, entries([1]));
		speak(frame.win(), "https://evil.hf.space", entries([1]));
		expect(frame.states.map((s) => s.state)).toEqual(["connecting"]);
		expect(frame.entries).toEqual([]);

		speak(frame.win(), location.origin, ack());
		expect(frame.states.at(-1)?.state).toBe("connected");
	});

	it("ignores other protocols, unknown types and non-objects, and reads a higher version", async () => {
		const frame = mount(silentFrameDoc());
		await frame.first;
		const from = (data: unknown) => speak(frame.win(), location.origin, data);
		from("supports-zerogpu-headers");
		from(null);
		from([1, 2]);
		from({ protocol: "trackio-view", version: 1, type: "ready" });
		from(ack({ protocol: "gradio-consoles" }));
		from(ack({ type: "ready" }));
		from(ack({ type: "init" }));
		from(entries([1], { type: "entry" }));
		expect(frame.states.map((s) => s.state)).toEqual(["connecting"]);
		expect(frame.entries).toEqual([]);

		from(ack({ version: 2, capabilities: ["stop"], dropped: 3 }));
		expect(frame.states.at(-1)).toMatchObject({ state: "connected", session: "s1" });
		from(
			entries([1, 2], {
				version: 2,
				entries: [
					{ seq: 1, ts: 1, level: "log", text: "kept", source: "app.js" },
					{ seq: 0, ts: 1, level: "log", text: "bad seq" },
					{ seq: 2, ts: 1, level: "trace", text: "new level" },
				],
			})
		);
		expect(frame.entries.map((e) => [e.seq, e.level, e.text])).toEqual([
			[1, "log", "kept"],
			[2, "trace", "new level"],
		]);
		expect(frame.entries[0]).not.toHaveProperty("source");
	});

	it("dedupes on (session_id, seq) across messages", async () => {
		const frame = mount(silentFrameDoc());
		await frame.first;
		const from = (data: unknown) => speak(frame.win(), location.origin, data);
		from(ack());
		from(entries([1, 2]));
		from(entries([2, 3]));
		from(entries([1], { session_id: "s2" }));
		expect(frame.entries.map((e) => [e.session_id, e.seq])).toEqual([
			["s1", 1],
			["s1", 2],
			["s1", 3],
			["s2", 1],
		]);
	});
});
