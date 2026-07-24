/**
 * Live generations feed (P4): GET /api/v2/generations/live.
 *
 * Reports the caller's own running generations so the sidebar can show which
 * conversations are generating and toast when a background one finishes. It is scoped
 * to the caller — another user's runs never appear — and releases the connection with
 * an `idle` event once nothing is running.
 */
import { test, expect, E2E_APP_URL, SESSION_COOKIE_NAME } from "./fixtures.ts";
import { ObjectId, type Db } from "mongodb";
import { randomUUID } from "node:crypto";

interface SseFrame {
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
		if (field === "event") frame.event = value;
		else if (field === "data") frame.data = frame.data ? `${frame.data}\n${value}` : value;
	}
	return frame;
}

interface SyncPayload {
	running: Array<{ conversationId: string; title: string }>;
	ended: Array<{ conversationId: string; status: string; title: string }>;
}

const syncFrames = (frames: SseFrame[]): SyncPayload[] =>
	frames.filter((f) => f.event === "sync").map((f) => JSON.parse(f.data ?? "{}") as SyncPayload);

/** Open the live feed and collect frames until `until` matches or the timeout fires. */
async function collectLive(opts: {
	secret: string;
	until: (f: SseFrame) => boolean;
	timeoutMs?: number;
}): Promise<{ status: number; frames: SseFrame[] }> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
	let res: Response;
	try {
		res = await fetch(`${E2E_APP_URL}/api/v2/generations/live`, {
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

/** Seed a conversation + a generation record with the given status/title. */
async function seedGeneration(
	db: Db,
	sessionId: string,
	opts: { status: "running" | "completed" | "interrupted" | "error"; title: string }
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
		title: opts.title,
		rootMessageId: systemId,
		messages: [
			{ id: systemId, from: "system", content: "", ancestors: [], children: [userId] },
			{ id: userId, from: "user", content: "go", ancestors: [systemId], children: [assistantId] },
			{
				id: assistantId,
				from: "assistant",
				content: "partial",
				generationId,
				materializedSeq: 1,
				updates: [],
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
		seq: 1,
		lastHeartbeatAt: now,
		startedAt: now,
		createdAt: now,
		updatedAt: now,
		...(terminal ? { endedAt: now } : {}),
	} as never);

	return { convId: conversationId.toString(), generationId };
}

test("reports a running generation, with its title, in the running set", async ({
	db,
	session,
}) => {
	test.setTimeout(30_000);
	const { convId } = await seedGeneration(db, session.sessionId, {
		status: "running",
		title: "long job",
	});

	const { frames } = await collectLive({
		secret: session.secret,
		until: (f) =>
			f.event === "sync" && (JSON.parse(f.data ?? "{}") as SyncPayload).running.length > 0,
	});

	const running = syncFrames(frames).flatMap((s) => s.running);
	const row = running.find((r) => r.conversationId === convId);
	expect(row, "the running generation should be reported").toBeTruthy();
	expect(row?.title).toBe("long job");
});

test("emits an ended event with the terminal status when a run completes", async ({
	db,
	session,
}) => {
	test.setTimeout(30_000);
	const { convId, generationId } = await seedGeneration(db, session.sessionId, {
		status: "running",
		title: "finishing soon",
	});

	// Flip the run to completed after the first tick has observed it running.
	const flip = (async () => {
		await new Promise((r) => setTimeout(r, 800));
		await db
			.collection("generations")
			.updateOne(
				{ generationId },
				{ $set: { status: "completed", endedAt: new Date(), updatedAt: new Date() } }
			);
	})();

	const { frames } = await collectLive({
		secret: session.secret,
		until: (f) =>
			f.event === "sync" && (JSON.parse(f.data ?? "{}") as SyncPayload).ended.length > 0,
		timeoutMs: 25_000,
	});
	await flip;

	const ended = syncFrames(frames).flatMap((s) => s.ended);
	const row = ended.find((e) => e.conversationId === convId);
	expect(row, "the completed run should be reported as ended").toBeTruthy();
	expect(row?.status).toBe("completed");
	expect(row?.title).toBe("finishing soon");
});

test("sends idle and closes when the caller has no running generations", async ({ session }) => {
	test.setTimeout(20_000);
	// No seeded runs for this fresh session.
	const { frames } = await collectLive({
		secret: session.secret,
		until: (f) => f.event === "idle",
		timeoutMs: 15_000,
	});
	expect(
		frames.some((f) => f.event === "idle"),
		"should go idle with nothing running"
	).toBe(true);
});

test("does not report another session's running generation", async ({ db, session }) => {
	test.setTimeout(20_000);
	const { convId } = await seedGeneration(db, "someone-elses-session", {
		status: "running",
		title: "not yours",
	});

	// This caller has nothing running, so the feed goes idle without ever listing it.
	const { frames } = await collectLive({
		secret: session.secret,
		until: (f) => f.event === "idle",
		timeoutMs: 15_000,
	});

	const running = syncFrames(frames).flatMap((s) => s.running);
	expect(
		running.some((r) => r.conversationId === convId),
		"must not leak across sessions"
	).toBe(false);
});
