import { afterEach, describe, expect, it, vi } from "vitest";
import {
	GRADIO_CONSOLE_PROTOCOL,
	createConsoleReceiver,
	type ConsoleState,
	type FrameConsoleState,
} from "./gradioConsole";
import { gradioConsoleFrameDoc, silentFrameDoc } from "./__fixtures__/gradioConsoleFrame";

type FrameWindow = Window & { console: Console; __gets: unknown[]; __sessionId?: string };

const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
	vi.useRealTimers();
});

/** a same origin srcdoc frame, which the fixture allowlists as localhost */
function mount(doc: string, loadId?: string) {
	const iframe = document.createElement("iframe");
	const states: { state: FrameConsoleState; session?: string; version?: string }[] = [];
	const snapshots: ConsoleState[] = [];
	const receiver = createConsoleReceiver({
		frame: () => iframe.contentWindow,
		origin: location.origin,
		onState: (state, reply) =>
			states.push({ state, session: reply?.session_id, version: reply?.gradio_version }),
		onSnapshot: (snapshot) => snapshots.push(snapshot),
	});
	const onMessage = (event: MessageEvent) => receiver.handleMessage(event);
	window.addEventListener("message", onMessage);
	const loaded = () =>
		new Promise<void>((resolve) =>
			iframe.addEventListener("load", () => resolve(), { once: true })
		);
	iframe.addEventListener("load", () => receiver.load(loadId));
	const first = loaded();
	iframe.srcdoc = doc;
	document.body.appendChild(iframe);
	cleanups.push(() => {
		window.removeEventListener("message", onMessage);
		receiver.dispose();
		iframe.remove();
	});
	const win = () => iframe.contentWindow as FrameWindow;
	const entries = () => snapshots.flatMap((snapshot) => snapshot.entries);
	return { iframe, receiver, states, snapshots, entries, win, first, loaded };
}

function speak(source: MessageEventSource | null, origin: string, data: unknown) {
	window.dispatchEvent(new MessageEvent("message", { data, origin, source }));
}

describe("gradio-console receiver against the fixture frame", () => {
	it("gets a state on load and dedupes entries across snapshots", async () => {
		const frame = mount(
			gradioConsoleFrameDoc(
				{ gradioVersion: "6.31.0" },
				`console.log("boot", {a: 1}); console.error(new TypeError("x is undefined"));`
			)
		);
		await frame.first;
		await vi.waitFor(() => expect(frame.snapshots).toHaveLength(1));
		expect(frame.states.at(-1)).toEqual({
			state: "connected",
			session: frame.win().__sessionId,
			version: "6.31.0",
		});
		expect(frame.entries().map((e) => e.text)).toEqual([
			'boot {"a":1}',
			"TypeError: x is undefined",
		]);
		expect(frame.entries()[1].stack).toContain("TypeError");
		expect(frame.win().__gets).toEqual([{ protocol: "gradio-console", version: 1, type: "get" }]);

		frame.win().console.warn("later");
		frame.receiver.request("check-2");
		await vi.waitFor(() => expect(frame.snapshots).toHaveLength(2));
		expect(frame.snapshots[1].id).toBe("check-2");
		expect(frame.snapshots[1].entries.map((e) => [e.seq, e.text])).toEqual([[3, "later"]]);
		expect(frame.states.filter((s) => s.state === "connected")).toHaveLength(1);
	});

	it("copies the get id back, from a load started for a check", async () => {
		const frame = mount(gradioConsoleFrameDoc(), "check-1");
		await frame.first;
		await vi.waitFor(() => expect(frame.snapshots).toHaveLength(1));
		expect(frame.snapshots[0].id).toBe("check-1");
		expect(frame.win().__gets[0]).toMatchObject({ type: "get", id: "check-1" });
	});

	it("reports the total the frame dropped since load", async () => {
		const frame = mount(
			gradioConsoleFrameDoc({}, `for (let i = 1; i <= 120; i++) console.log("line " + i);`)
		);
		await frame.first;
		await vi.waitFor(() => expect(frame.snapshots).toHaveLength(1));
		expect(frame.snapshots[0].dropped).toBe(20);
		expect(frame.entries().map((e) => e.seq)).toEqual(
			Array.from({ length: 100 }, (_, i) => i + 21)
		);
	});

	it("restarts the sequence on a reload and keeps the earlier page load's entries", async () => {
		const frame = mount(gradioConsoleFrameDoc({}, `console.log("load");`));
		await frame.first;
		await vi.waitFor(() => expect(frame.snapshots).toHaveLength(1));
		const firstSession = frame.win().__sessionId;

		const reloaded = frame.loaded();
		frame.win().location.reload();
		await reloaded;
		await vi.waitFor(() => expect(frame.snapshots).toHaveLength(2));
		const secondSession = frame.win().__sessionId;
		expect(secondSession).not.toBe(firstSession);
		expect(frame.states.map((s) => s.state)).toEqual([
			"connecting",
			"connected",
			"connecting",
			"connected",
		]);
		expect(frame.entries().map((e) => [e.session_id, e.seq])).toEqual([
			[firstSession, 1],
			[secondSession, 1],
		]);
	});

	it("upgrades an unsupported frame when a later get is answered", async () => {
		const frame = mount(gradioConsoleFrameDoc({ answerAfterMs: 5500 }, `console.log("late");`));
		await frame.first;
		await vi.waitFor(() => expect(frame.states.at(-1)?.state).toBe("unsupported"), {
			timeout: 7000,
		});
		expect(frame.snapshots).toEqual([]);
		await new Promise((r) => setTimeout(r, 600));
		frame.receiver.request("check-9");
		await vi.waitFor(() => expect(frame.snapshots).toHaveLength(1));
		expect(frame.states.at(-1)?.state).toBe("connected");
		expect(frame.snapshots[0]).toMatchObject({ id: "check-9", entries: [{ text: "late" }] });
	}, 15_000);
});

describe("gradio-console receiver with a frame that never answers", () => {
	it("retries get at 500, 1500 and 3000 ms, then marks it unsupported at 5 s", async () => {
		const frame = mount(silentFrameDoc());
		await frame.first;
		// the load listener already started a sequence on real timers
		await vi.waitFor(() => expect(frame.win().__gets).toHaveLength(1));
		frame.receiver.dispose();
		frame.win().__gets.length = 0;
		vi.useFakeTimers();
		frame.receiver.load();
		// vi.waitFor would advance the fake clock itself
		const yieldTask = () =>
			new Promise((resolve) => {
				const channel = new MessageChannel();
				channel.port1.onmessage = resolve;
				channel.port2.postMessage(0);
			});
		const gets = async (expected: number) => {
			for (let i = 0; i < 50 && frame.win().__gets.length < expected; i++) await yieldTask();
			for (let i = 0; i < 5; i++) await yieldTask();
			return frame.win().__gets.length;
		};
		expect(await gets(1)).toBe(1);
		vi.advanceTimersByTime(499);
		expect(await gets(2)).toBe(1);
		vi.advanceTimersByTime(1);
		expect(await gets(2)).toBe(2);
		vi.advanceTimersByTime(1000);
		expect(await gets(3)).toBe(3);
		vi.advanceTimersByTime(1500);
		expect(await gets(4)).toBe(4);
		expect(frame.win().__gets[0]).toEqual({ protocol: "gradio-console", version: 1, type: "get" });
		vi.advanceTimersByTime(1999);
		expect(frame.states.at(-1)?.state).toBe("connecting");
		vi.advanceTimersByTime(1);
		expect(frame.states.at(-1)?.state).toBe("unsupported");
		vi.advanceTimersByTime(60_000);
		expect(await gets(5)).toBe(4);
	});
});

describe("gradio-console receiver message filtering", () => {
	const state = (extra: Record<string, unknown> = {}) => ({
		protocol: GRADIO_CONSOLE_PROTOCOL,
		version: 1,
		type: "state",
		session_id: "s1",
		gradio_version: "6.31.0",
		dropped: 0,
		entries: [{ seq: 1, ts: 1, level: "log", text: "e1" }],
		...extra,
	});

	it("ignores the wrong source or origin", async () => {
		const frame = mount(silentFrameDoc());
		await frame.first;
		speak(window, location.origin, state());
		speak(frame.win(), "https://evil.hf.space", state());
		speak(frame.win(), location.origin.replace("localhost", "127.0.0.1"), state());
		expect(frame.states.map((s) => s.state)).toEqual(["connecting"]);
		expect(frame.snapshots).toEqual([]);

		speak(frame.win(), location.origin, state());
		expect(frame.states.at(-1)?.state).toBe("connected");
		expect(frame.snapshots).toHaveLength(1);
	});

	it("ignores other protocols, unknown types and non-objects, and reads a higher version", async () => {
		const frame = mount(silentFrameDoc());
		await frame.first;
		const from = (data: unknown) => speak(frame.win(), location.origin, data);
		from("supports-zerogpu-headers");
		from(null);
		from([1, 2]);
		from({ protocol: "trackio-view", version: 1, type: "ready" });
		from(state({ protocol: "gradio-consoles" }));
		from(state({ type: "ack" }));
		from(state({ type: "entries" }));
		from(state({ type: "get" }));
		from(state({ session_id: "" }));
		expect(frame.states.map((s) => s.state)).toEqual(["connecting"]);
		expect(frame.snapshots).toEqual([]);

		from(
			state({
				version: 2,
				capabilities: ["stop"],
				entries: [
					{ seq: 1, ts: 1, level: "log", text: "kept", source: "app.js" },
					{ seq: 0, ts: 1, level: "log", text: "bad seq" },
					{ seq: 2, ts: 1, level: "trace", text: "new level" },
				],
			})
		);
		expect(frame.states.at(-1)).toMatchObject({ state: "connected", session: "s1" });
		expect(frame.snapshots[0]).not.toHaveProperty("capabilities");
		expect(frame.entries().map((e) => [e.seq, e.level, e.text])).toEqual([
			[1, "log", "kept"],
			[2, "trace", "new level"],
		]);
		expect(frame.entries()[0]).not.toHaveProperty("source");
	});

	it("dedupes on (session_id, seq) across snapshots and sessions", async () => {
		const frame = mount(silentFrameDoc());
		await frame.first;
		const from = (data: unknown) => speak(frame.win(), location.origin, data);
		const entries = (seqs: number[]) =>
			seqs.map((seq) => ({ seq, ts: 1, level: "log", text: `e${seq}` }));
		from(state({ entries: entries([1, 2]) }));
		from(state({ entries: entries([1, 2, 3]) }));
		from(state({ session_id: "s2", entries: entries([1]) }));
		from(state({ entries: entries([3]) }));
		expect(frame.snapshots.map((s) => s.entries.map((e) => `${e.session_id}:${e.seq}`))).toEqual([
			["s1:1", "s1:2"],
			["s1:3"],
			["s2:1"],
			[],
		]);
	});
});
