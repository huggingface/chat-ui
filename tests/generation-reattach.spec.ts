/**
 * Reattach stream endpoint (P3): GET /conversation/:id/stream.
 *
 * Replays a run's events from a cursor, tails for new ones, and ends when the run is
 * terminal — so a returning tab or second device resumes a live generation at the token
 * it left off, cross-pod, without polling or reloading the conversation.
 */
import { test, expect, E2E_APP_URL, SESSION_COOKIE_NAME } from "./fixtures.ts";
import { ObjectId, type Db } from "mongodb";
import { randomUUID } from "node:crypto";

interface SseFrame {
	id?: string;
	event?: string;
	data?: string;
	comment?: boolean;
}

function parseFrame(raw: string): SseFrame {
	if (raw.startsWith(":")) return { comment: true };
	const frame: SseFrame = {};
	for (const line of raw.split("\n")) {
		const idx = line.indexOf(":");
		if (idx === -1) continue;
		const field = line.slice(0, idx);
		const value = line.slice(idx + 1).replace(/^ /, "");
		if (field === "id") frame.id = value;
		else if (field === "event") frame.event = value;
		else if (field === "data") frame.data = frame.data ? `${frame.data}\n${value}` : value;
	}
	return frame;
}

/** Open the SSE endpoint and collect frames until `until` matches or the timeout fires. */
async function collectFrames(opts: {
	convId: string;
	secret: string;
	query: string;
	until: (f: SseFrame) => boolean;
	timeoutMs?: number;
}): Promise<{ status: number; frames: SseFrame[] }> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
	let res: Response;
	try {
		res = await fetch(`${E2E_APP_URL}/conversation/${opts.convId}/stream?${opts.query}`, {
			headers: { cookie: `${SESSION_COOKIE_NAME}=${opts.secret}`, accept: "text/event-stream" },
			signal: controller.signal,
		});
	} catch (err) {
		clearTimeout(timer);
		throw err;
	}
	if (!res.ok || !res.body) {
		clearTimeout(timer);
		return { status: res.status, frames: [] };
	}
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	const frames: SseFrame[] = [];
	let buffer = "";
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let sep: number;
			while ((sep = buffer.indexOf("\n\n")) !== -1) {
				const frame = parseFrame(buffer.slice(0, sep));
				buffer = buffer.slice(sep + 2);
				frames.push(frame);
				if (opts.until(frame)) {
					controller.abort();
					clearTimeout(timer);
					return { status: 200, frames };
				}
			}
		}
	} catch {
		// aborted (timeout) — return what we have
	}
	clearTimeout(timer);
	return { status: 200, frames };
}

const updates = (frames: SseFrame[]) => frames.filter((f) => f.event === "update");
const endFrame = (frames: SseFrame[]) => frames.find((f) => f.event === "end");

/** Seed a conversation, a generation record, and `tokenCount` stream events (seq 1..N). */
async function seedRun(
	db: Db,
	sessionId: string,
	opts: { tokenCount: number; status: "running" | "completed" | "interrupted" }
): Promise<{ convId: string; generationId: string }> {
	const now = new Date();
	const systemId = randomUUID();
	const userId = randomUUID();
	const assistantId = randomUUID();
	const generationId = randomUUID();
	const conversationId = new ObjectId();
	const terminal = opts.status !== "running";

	await db.collection("conversations").insertOne({
		_id: conversationId,
		sessionId,
		model: "test-org/test-model",
		title: "reattach seed",
		rootMessageId: systemId,
		messages: [
			{ id: systemId, from: "system", content: "", ancestors: [], children: [userId] },
			{ id: userId, from: "user", content: "go", ancestors: [systemId], children: [assistantId] },
			{
				id: assistantId,
				from: "assistant",
				content: Array.from({ length: opts.tokenCount }, (_, i) => `tok${i} `).join(""),
				generationId,
				materializedSeq: opts.tokenCount,
				updates: [],
				...(terminal ? { interrupted: opts.status === "interrupted" } : {}),
				ancestors: [systemId, userId],
				children: [],
			},
		],
		createdAt: now,
		updatedAt: now,
	} as never);

	await db.collection("generations").insertOne({
		_id: new ObjectId(),
		generationId,
		conversationId,
		messageId: assistantId,
		sessionId,
		status: opts.status,
		seq: opts.tokenCount,
		lastHeartbeatAt: now,
		startedAt: now,
		createdAt: now,
		updatedAt: now,
		...(terminal ? { endedAt: now } : {}),
	} as never);

	if (opts.tokenCount > 0) {
		await db.collection("generationEvents").insertMany(
			Array.from({ length: opts.tokenCount }, (_, i) => ({
				_id: new ObjectId(),
				generationId,
				seq: i + 1,
				event: { type: "stream", token: `tok${i} ` },
				createdAt: now,
			})) as never[]
		);
	}

	return { convId: conversationId.toString(), generationId };
}

test("replays all events from the start, then ends on a terminal run", async ({ db, session }) => {
	test.setTimeout(30_000);
	const { convId, generationId } = await seedRun(db, session.sessionId, {
		tokenCount: 5,
		status: "completed",
	});

	const { frames } = await collectFrames({
		convId,
		secret: session.secret,
		query: `generationId=${generationId}&fromSeq=0`,
		until: (f) => f.event === "end",
	});

	const ups = updates(frames);
	expect(ups.map((f) => f.id)).toEqual(["1", "2", "3", "4", "5"]);
	expect(ups.map((f) => JSON.parse(f.data ?? "{}").token)).toEqual([
		"tok0 ",
		"tok1 ",
		"tok2 ",
		"tok3 ",
		"tok4 ",
	]);
	expect(JSON.parse(endFrame(frames)?.data ?? "{}").status).toBe("completed");
});

test("resumes from fromSeq, replaying only later events", async ({ db, session }) => {
	test.setTimeout(30_000);
	const { convId, generationId } = await seedRun(db, session.sessionId, {
		tokenCount: 5,
		status: "completed",
	});

	const { frames } = await collectFrames({
		convId,
		secret: session.secret,
		query: `generationId=${generationId}&fromSeq=2`,
		until: (f) => f.event === "end",
	});

	// Only events after seq 2 — no duplication, no gap.
	expect(updates(frames).map((f) => f.id)).toEqual(["3", "4", "5"]);
});

test("waits for a temporarily invisible sequence before advancing the cursor", async ({
	db,
	session,
}) => {
	test.setTimeout(30_000);
	const { convId, generationId } = await seedRun(db, session.sessionId, {
		tokenCount: 0,
		status: "running",
	});
	const now = new Date();

	// Model an unordered insert becoming visible non-atomically: seq 3 can be
	// observed while seq 2 is still absent.
	await db.collection("generationEvents").insertMany([
		{
			_id: new ObjectId(),
			generationId,
			seq: 1,
			event: { type: "stream", token: "one " },
			createdAt: now,
		},
		{
			_id: new ObjectId(),
			generationId,
			seq: 3,
			event: { type: "stream", token: "three " },
			createdAt: now,
		},
	] as never[]);
	await db.collection("generations").updateOne({ generationId }, { $set: { seq: 3 } });

	const collecting = collectFrames({
		convId,
		secret: session.secret,
		query: `generationId=${generationId}&fromSeq=0`,
		until: (f) => f.event === "end",
	});

	// Let the initial drain observe 1 and 3, then make the missing event visible.
	await new Promise((resolve) => setTimeout(resolve, 100));
	await db.collection("generationEvents").insertOne({
		_id: new ObjectId(),
		generationId,
		seq: 2,
		event: { type: "stream", token: "two " },
		createdAt: new Date(),
	} as never);
	await db
		.collection("generations")
		.updateOne(
			{ generationId },
			{ $set: { status: "completed", endedAt: new Date(), updatedAt: new Date() } }
		);

	const { frames } = await collecting;
	expect(updates(frames).map((f) => f.id)).toEqual(["1", "2", "3"]);
	expect(
		updates(frames)
			.map((f) => JSON.parse(f.data ?? "{}").token)
			.join("")
	).toBe("one two three ");
});

test("an interrupted run ends with status interrupted", async ({ db, session }) => {
	test.setTimeout(30_000);
	const { convId, generationId } = await seedRun(db, session.sessionId, {
		tokenCount: 2,
		status: "interrupted",
	});
	const { frames } = await collectFrames({
		convId,
		secret: session.secret,
		query: `generationId=${generationId}`,
		until: (f) => f.event === "end",
	});
	expect(JSON.parse(endFrame(frames)?.data ?? "{}").status).toBe("interrupted");
});

test("a conversation with no run ends cleanly rather than hanging", async ({
	seedConversation,
	session,
}) => {
	test.setTimeout(20_000);
	const convId = await seedConversation({ title: "no run" });
	const { frames } = await collectFrames({
		convId: convId.toString(),
		secret: session.secret,
		query: "fromSeq=0",
		until: (f) => f.event === "end",
	});
	expect(JSON.parse(endFrame(frames)?.data ?? "{}").status).toBe("gone");
});

test("rejects a conversation the caller does not own", async ({ db, session }) => {
	test.setTimeout(20_000);
	// Seed under a different session.
	const { convId } = await seedRun(db, "someone-elses-session", {
		tokenCount: 1,
		status: "completed",
	});
	const { status } = await collectFrames({
		convId,
		secret: session.secret,
		query: "fromSeq=0",
		until: () => true,
		timeoutMs: 5_000,
	});
	expect(status).toBe(404);
});

test("tails a live generation to completion (writer → endpoint)", async ({
	api,
	session,
	mockOpenAI,
}) => {
	test.setTimeout(60_000);
	const { conversationId, rootMessageId } = await api.createConversation();
	await mockOpenAI.setScenario(conversationId, {
		content: Array.from({ length: 20 }, (_, i) => `w${i} `),
		chunkDelayMs: 400, // ~8s of streaming
		finishReason: "stop",
	});

	// Kick off the real generation (attached), draining it in the background.
	const form = new FormData();
	form.append("data", JSON.stringify({ inputs: "tail me", id: rootMessageId, is_retry: false }));
	const genRes = await fetch(`${E2E_APP_URL}/conversation/${conversationId}`, {
		method: "POST",
		body: form,
		headers: { origin: E2E_APP_URL, cookie: `${SESSION_COOKIE_NAME}=${session.secret}` },
	});
	if (!genRes.body) throw new Error("generation response had no body");
	const genReader = genRes.body.getReader();
	const genDrain = (async () => {
		for (;;) {
			const { done } = await genReader.read();
			if (done) break;
		}
	})();

	// Reattach as a separate viewer (no generationId → newest run), from the start.
	const { frames } = await collectFrames({
		convId: conversationId,
		secret: session.secret,
		query: "fromSeq=0",
		until: (f) => f.event === "end",
		timeoutMs: 40_000,
	});

	const ups = updates(frames);
	expect(ups.length, "should have streamed events while tailing").toBeGreaterThan(0);
	// Reassembling the streamed tokens reproduces the answer.
	const streamed = ups
		.map((f) => JSON.parse(f.data ?? "{}"))
		.filter((u) => u.type === "stream")
		.map((u) => u.token)
		.join("");
	expect(streamed).toContain("w0 ");
	expect(streamed).toContain("w19 ");
	// Sequence numbers are strictly increasing across the whole tail.
	const ids = ups.map((f) => Number(f.id));
	expect(ids).toEqual([...ids].sort((a, b) => a - b));
	expect(JSON.parse(endFrame(frames)?.data ?? "{}").status).toBe("completed");

	await genDrain;
});
