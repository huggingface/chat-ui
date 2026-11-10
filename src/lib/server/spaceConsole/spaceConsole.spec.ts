import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import { SPACE_CONSOLE_INDEXES, SPACE_CONSOLE_TTL_SECONDS } from "./indexes";
import {
	SPACE_CONSOLE_KEEP,
	readConsoleEntries,
	readFrame,
	recordConsoleEntries,
	recordFrameState,
	type IncomingConsoleEntry,
} from "./store";
import { consoleSection, formatConsole, type ConsoleWaits } from "./section";

beforeAll(async () => {
	await ready;
	for (const index of SPACE_CONSOLE_INDEXES.entries) {
		await collections.spaceConsoleEntries.createIndex(index.keys, index.options);
	}
	for (const index of SPACE_CONSOLE_INDEXES.frames) {
		await collections.spaceConsoleFrames.createIndex(index.keys, index.options);
	}
});

afterEach(async () => {
	vi.useRealTimers();
	await collections.spaceConsoleEntries.deleteMany({});
	await collections.spaceConsoleFrames.deleteMany({});
});

const SPACE = "pngwn/demo";
const entry = (seq: number, sessionId = "s1", text = `entry ${seq}`): IncomingConsoleEntry => ({
	sessionId,
	seq,
	ts: seq,
	level: "log",
	text,
});

describe("space console store", () => {
	it("expires entries and frames after 30 minutes", async () => {
		const ttl = async (name: "spaceConsoleEntries" | "spaceConsoleFrames") =>
			(await collections[name].indexes()).find((index) => index.expireAfterSeconds !== undefined)
				?.expireAfterSeconds;
		expect(SPACE_CONSOLE_TTL_SECONDS).toBe(1800);
		expect(await ttl("spaceConsoleEntries")).toBe(1800);
		expect(await ttl("spaceConsoleFrames")).toBe(1800);
	});

	it("reads past rows the TTL monitor has not swept yet as gone", async () => {
		const conversationId = new ObjectId();
		await recordConsoleEntries(conversationId, SPACE, [entry(1), entry(2)]);
		await recordFrameState({ conversationId, spaceId: SPACE, loadId: "l", state: "loading" });
		await collections.spaceConsoleEntries.updateOne(
			{ conversationId, seq: 1 },
			{ $set: { createdAt: new Date(Date.now() - 31 * 60_000) } }
		);
		expect((await readConsoleEntries(conversationId, SPACE)).map((e) => e.seq)).toEqual([2]);
		await collections.spaceConsoleFrames.updateOne(
			{ conversationId },
			{ $set: { updatedAt: new Date(Date.now() - 31 * 60_000) } }
		);
		expect(await readFrame(conversationId, SPACE)).toBeNull();
	});

	it("ignores a (session, seq) it already has", async () => {
		const conversationId = new ObjectId();
		expect(await recordConsoleEntries(conversationId, SPACE, [entry(1), entry(2)])).toBe(2);
		expect(
			await recordConsoleEntries(conversationId, SPACE, [entry(2), entry(3), entry(1, "s2")])
		).toBe(2);
		const stored = await readConsoleEntries(conversationId, SPACE);
		expect(stored.map((e) => [e.sessionId, e.seq])).toEqual([
			["s1", 1],
			["s1", 2],
			["s1", 3],
			["s2", 1],
		]);
	});

	it("keeps the newest 100 per conversation and Space", async () => {
		const conversationId = new ObjectId();
		const other = new ObjectId();
		await recordConsoleEntries(other, SPACE, [entry(1)]);
		await recordConsoleEntries(conversationId, "pngwn/other", [entry(1)]);
		for (let start = 1; start <= 130; start += 50) {
			const batch = Array.from({ length: Math.min(50, 131 - start) }, (_, i) => entry(start + i));
			await recordConsoleEntries(conversationId, SPACE, batch);
		}
		const stored = await readConsoleEntries(conversationId, SPACE);
		expect(stored).toHaveLength(SPACE_CONSOLE_KEEP);
		expect(stored[0].seq).toBe(31);
		expect(stored.at(-1)?.seq).toBe(130);
		expect(await readConsoleEntries(other, SPACE)).toHaveLength(1);
		expect(await readConsoleEntries(conversationId, "pngwn/other")).toHaveLength(1);
	});

	it("starts a frame over on load and ignores a late update from the load before", async () => {
		const conversationId = new ObjectId();
		const base = { conversationId, spaceId: SPACE };
		await recordFrameState({ ...base, loadId: "l1", checkId: "c1", state: "loading" });
		await recordFrameState({
			...base,
			loadId: "l1",
			state: "connected",
			sessionId: "s1",
			gradioVersion: "6.31.0",
		});
		await recordFrameState({ ...base, loadId: "l2", checkId: "c2", state: "loading" });
		await recordFrameState({ ...base, loadId: "l1", state: "unsupported" });
		expect(await readFrame(conversationId, SPACE)).toMatchObject({
			loadId: "l2",
			checkId: "c2",
			state: "loading",
		});
		const frame = await readFrame(conversationId, SPACE);
		expect(frame?.sessionId).toBeUndefined();
		expect(frame?.gradioVersion).toBeUndefined();
	});
});

const FAST: ConsoleWaits = { attachMs: 300, handshakeMs: 300, settleMs: 50, pollMs: 20 };

describe("console section", () => {
	it("says in one line when no tab opened the Space", async () => {
		const lines = await consoleSection({
			conversationId: new ObjectId(),
			spaceId: SPACE,
			checkId: "c1",
			waits: FAST,
		});
		expect(lines).toEqual([
			"Console: no browser tab has this Space open, so its browser console can't be read.",
		]);
	});

	it("does not count a tab that loaded the Space for an earlier check", async () => {
		const conversationId = new ObjectId();
		await recordFrameState({
			conversationId,
			spaceId: SPACE,
			loadId: "l1",
			checkId: "c0",
			state: "loading",
		});
		await recordFrameState({ conversationId, spaceId: SPACE, loadId: "l1", state: "connected" });
		const lines = await consoleSection({
			conversationId,
			spaceId: SPACE,
			checkId: "c1",
			waits: FAST,
		});
		expect(lines[0]).toContain("no browser tab");
	});

	it("waits for the tab, the ack and the page-load entries", async () => {
		const conversationId = new ObjectId();
		const reading = consoleSection({ conversationId, spaceId: SPACE, checkId: "c1", waits: FAST });
		await new Promise((r) => setTimeout(r, 60));
		await recordFrameState({
			conversationId,
			spaceId: SPACE,
			loadId: "l1",
			checkId: "c1",
			state: "loading",
		});
		await new Promise((r) => setTimeout(r, 60));
		await recordFrameState({
			conversationId,
			spaceId: SPACE,
			loadId: "l1",
			state: "connected",
			sessionId: "s1",
			gradioVersion: "6.31.0",
		});
		await recordConsoleEntries(conversationId, SPACE, [
			{
				...entry(1, "s1", "Uncaught TypeError: x is undefined"),
				level: "exception",
				stack: "TypeError: x is undefined\n    at App (index.js:3:9)",
			},
		]);
		expect(await reading).toEqual([
			"Console (browser tab, Gradio 6.31.0): 1 entry, oldest first:",
			"  [exception] Uncaught TypeError: x is undefined",
			"    TypeError: x is undefined",
			"    at App (index.js:3:9)",
		]);
	});

	it("reports a frame that never acked", async () => {
		const conversationId = new ObjectId();
		const base = { conversationId, spaceId: SPACE, loadId: "l1" };
		await recordFrameState({ ...base, checkId: "c1", state: "loading" });
		await recordFrameState({ ...base, state: "unsupported" });
		const lines = await consoleSection({
			conversationId,
			spaceId: SPACE,
			checkId: "c1",
			waits: FAST,
		});
		expect(lines[0]).toContain("does not forward its console");
	});

	it("tags page loads and cuts the middle of a long console", () => {
		const at = (seq: number, sessionId: string) => ({
			...entry(seq, sessionId),
			_id: new ObjectId(),
			conversationId: new ObjectId(),
			spaceId: SPACE,
			createdAt: new Date(),
		});
		const entries = [
			...Array.from({ length: 5 }, (_, i) => at(i + 1, "old")),
			...Array.from({ length: 50 }, (_, i) => at(i + 1, "new")),
		];
		const out = formatConsole(entries, "new", "");
		expect(out[0]).toBe("Console (browser tab): 55 entries, oldest first, from 2 page loads:");
		expect(out[1]).toBe("page load 1:");
		expect(out).toContain("  …[15 entries omitted]…");
		expect(out).toContain("page load 2 (the one this check opened):");
		expect(out.at(-1)).toBe("  [log] entry 50");
	});

	it("says when the page load it opened logged nothing", () => {
		const old = {
			...entry(1, "old"),
			_id: new ObjectId(),
			conversationId: new ObjectId(),
			spaceId: SPACE,
			createdAt: new Date(),
		};
		expect(formatConsole([old], "new", "6.31.0")).toEqual([
			"Console (browser tab, Gradio 6.31.0): 1 entry, oldest first:",
			"page load 1:",
			"  [log] entry 1",
			"The page load this check opened has logged nothing.",
		]);
		expect(formatConsole([], "new", "6.31.0")).toEqual([
			"Console (browser tab, Gradio 6.31.0): nothing logged since the page loaded.",
		]);
	});
});
