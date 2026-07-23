/**
 * Generation reaper (P2).
 *
 * A run whose pod dies stays `status: running` forever with a frozen heartbeat. The reaper
 * finds these and marks them (and their message) interrupted, so a dead run is detected in
 * ~seconds and reads as interrupted rather than spinning or masquerading as a finished answer.
 * The critical safety property is the inverse: a *live* run, which heartbeats, is never reaped.
 *
 * Timers are scaled down in `playwright.config.ts` (heartbeat 1s, stale-after 5s, sweep 1s).
 */
import { test, expect, E2E_APP_URL, SESSION_COOKIE_NAME } from "./fixtures.ts";
import { ObjectId, type Db } from "mongodb";
import { randomUUID } from "node:crypto";

interface AssistantState {
	content: string;
	interrupted?: boolean;
	generationId?: string;
}

async function readAssistant(db: Db, conversationId: ObjectId): Promise<AssistantState> {
	const conv = await db.collection("conversations").findOne({ _id: conversationId });
	const messages = (conv?.messages ?? []) as Array<AssistantState & { from: string }>;
	const last = [...messages].reverse().find((m) => m.from === "assistant");
	return {
		content: last?.content ?? "",
		interrupted: last?.interrupted,
		generationId: last?.generationId,
	};
}

/** Seed a conversation with one non-terminal assistant message plus its generation record. */
async function seedRunningGeneration(
	db: Db,
	sessionId: string,
	opts: { heartbeatAgeMs: number; status?: "running" | "completed" }
): Promise<{ conversationId: ObjectId; generationId: string; messageId: string }> {
	const now = new Date();
	const systemId = randomUUID();
	const userId = randomUUID();
	const assistantId = randomUUID();
	const generationId = randomUUID();
	const conversationId = new ObjectId();

	await db.collection("conversations").insertOne({
		_id: conversationId,
		sessionId,
		model: "test-org/test-model",
		title: "reaper seed",
		rootMessageId: systemId,
		messages: [
			{ id: systemId, from: "system", content: "", ancestors: [], children: [userId] },
			{
				id: userId,
				from: "user",
				content: "do a long thing",
				ancestors: [systemId],
				children: [assistantId],
			},
			{
				id: assistantId,
				from: "assistant",
				// Non-terminal: partial content, no finalAnswer/finished/error/interrupted.
				content: "partial output so far",
				generationId,
				materializedSeq: 3,
				updates: [],
				ancestors: [systemId, userId],
				children: [],
			},
		],
		createdAt: now,
		updatedAt: now,
	} as never);

	const heartbeatAt = new Date(Date.now() - opts.heartbeatAgeMs);
	await db.collection("generations").insertOne({
		_id: new ObjectId(),
		generationId,
		conversationId,
		messageId: assistantId,
		sessionId,
		status: opts.status ?? "running",
		seq: 3,
		lastHeartbeatAt: heartbeatAt,
		startedAt: heartbeatAt,
		createdAt: heartbeatAt,
		updatedAt: heartbeatAt,
		...(opts.status === "completed" ? { endedAt: heartbeatAt } : {}),
	} as never);

	return { conversationId, generationId, messageId: assistantId };
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 20_000): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await check()) return true;
		await new Promise((r) => setTimeout(r, 500));
	}
	return false;
}

test("a run whose heartbeat has gone stale is marked interrupted", async ({ db, session }) => {
	test.setTimeout(60_000);
	// Heartbeat 60s old, far past the 5s stale threshold.
	const { conversationId, generationId } = await seedRunningGeneration(db, session.sessionId, {
		heartbeatAgeMs: 60_000,
	});

	const reaped = await waitFor(async () => {
		const gen = await db.collection("generations").findOne({ generationId });
		return gen?.status === "interrupted";
	});
	expect(reaped, "reaper should mark the stale run interrupted").toBe(true);

	const gen = await db.collection("generations").findOne({ generationId });
	expect(gen?.endedAt).toBeTruthy();

	// The message flag is what the rest of the app reads for terminality.
	const state = await readAssistant(db, conversationId);
	expect(state.interrupted, "the message must be flagged interrupted").toBe(true);
	// Content is preserved, not blanked or replaced with a fake final answer.
	expect(state.content).toBe("partial output so far");
});

test("interrupted is distinguishable from completed", async ({ db, session }) => {
	test.setTimeout(60_000);
	const { generationId } = await seedRunningGeneration(db, session.sessionId, {
		heartbeatAgeMs: 60_000,
	});
	await waitFor(async () => {
		const gen = await db.collection("generations").findOne({ generationId });
		return gen?.status === "interrupted";
	});
	const gen = await db.collection("generations").findOne({ generationId });
	// Not "completed": a reaped run is explicitly an interruption, never a success.
	expect(gen?.status).toBe("interrupted");
});

test("a completed run is never touched by the reaper", async ({ db, session }) => {
	test.setTimeout(30_000);
	// Old heartbeat, but already terminal — the status guard must skip it.
	const { generationId } = await seedRunningGeneration(db, session.sessionId, {
		heartbeatAgeMs: 60_000,
		status: "completed",
	});
	// Give several sweeps a chance to (wrongly) touch it.
	await new Promise((r) => setTimeout(r, 6000));
	const gen = await db.collection("generations").findOne({ generationId });
	expect(gen?.status).toBe("completed");
});

test("a live, heartbeating run survives past the stale threshold", async ({
	api,
	db,
	session,
	mockOpenAI,
}) => {
	test.setTimeout(60_000);
	const { conversationId, rootMessageId } = await api.createConversation();
	// ~20s of streaming: comfortably longer than the 5s stale threshold, so a run
	// that was NOT heartbeating would be reaped several times over during it.
	await mockOpenAI.setScenario(conversationId, {
		content: Array.from({ length: 40 }, (_, i) => `w${i} `),
		chunkDelayMs: 500,
		finishReason: "stop",
	});

	const form = new FormData();
	form.append("data", JSON.stringify({ inputs: "live run", id: rootMessageId, is_retry: false }));
	const res = await fetch(`${E2E_APP_URL}/conversation/${conversationId}`, {
		method: "POST",
		body: form,
		headers: { origin: E2E_APP_URL, cookie: `${SESSION_COOKIE_NAME}=${session.secret}` },
	});
	if (!res.body) throw new Error("no stream body");
	const reader = res.body.getReader();
	const drained = (async () => {
		for (;;) {
			const chunk = await reader.read();
			if (chunk.done) break;
		}
	})();

	const convObjId = new ObjectId(conversationId);
	// Sample across ~12s (many stale thresholds and sweeps). A live run must never
	// flip to interrupted while it is streaming.
	for (let i = 0; i < 12; i++) {
		await new Promise((r) => setTimeout(r, 1000));
		const state = await readAssistant(db, convObjId);
		if (state.generationId) {
			const gen = await db.collection("generations").findOne({ generationId: state.generationId });
			expect(gen?.status, `sweep ${i}: a heartbeating run must not be reaped`).not.toBe(
				"interrupted"
			);
			expect(state.interrupted ?? false, `sweep ${i}: message must not be interrupted`).toBe(false);
		}
	}

	await drained;
	await new Promise((r) => setTimeout(r, 1500));
	const state = await readAssistant(db, convObjId);
	const gen = await db.collection("generations").findOne({ generationId: state.generationId });
	expect(gen?.status, "the run should end completed, not interrupted").toBe("completed");
});

test("feature-flags exposes resumableGenerations", async ({ page }) => {
	const res = await page.request.get(`${E2E_APP_URL}/api/v2/feature-flags`);
	expect(res.ok()).toBe(true);
	// superjson envelope: the flag lives under json.
	const body = await res.text();
	expect(body).toContain("resumableGenerations");
	expect(body).toContain("true");
});
