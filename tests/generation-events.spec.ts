/**
 * Generation event log (P1).
 *
 * The behaviour under test is the one that used to be broken in the least visible way: while a
 * client stayed attached to its own POST stream, the generation wrote *nothing* to the database
 * for its entire duration. A long run was therefore invisible to any second tab or device, and
 * lost entirely if the pod died — and the longer the run, the more it lost.
 */
import { test, expect, E2E_APP_URL, SESSION_COOKIE_NAME } from "./fixtures.ts";
import { ObjectId, type Db } from "mongodb";
import type { MessageUpdate } from "$lib/types/MessageUpdate";

interface StoredEvent {
	generationId: string;
	seq: number;
	event: MessageUpdate;
}

interface AssistantState {
	content: string;
	generationId?: string;
	materializedSeq?: number;
	updates?: MessageUpdate[];
}

async function readAssistant(db: Db, conversationId: string): Promise<AssistantState> {
	const conv = await db.collection("conversations").findOne({ _id: new ObjectId(conversationId) });
	const messages = (conv?.messages ?? []) as Array<AssistantState & { from: string }>;
	const last = [...messages].reverse().find((m) => m.from === "assistant");
	return {
		content: last?.content ?? "",
		generationId: last?.generationId,
		materializedSeq: last?.materializedSeq,
		updates: last?.updates,
	};
}

async function readEvents(db: Db, generationId: string): Promise<StoredEvent[]> {
	return (await db
		.collection("generationEvents")
		.find({ generationId })
		.sort({ seq: 1 })
		.toArray()) as unknown as StoredEvent[];
}

/** Raw fetch, so the client stays genuinely attached and draining for the whole run. */
async function startAttachedGeneration(opts: {
	conversationId: string;
	parentId: string;
	secret: string;
	content: string;
}) {
	const form = new FormData();
	form.append("data", JSON.stringify({ inputs: opts.content, id: opts.parentId, is_retry: false }));
	const res = await fetch(`${E2E_APP_URL}/conversation/${opts.conversationId}`, {
		method: "POST",
		body: form,
		headers: { origin: E2E_APP_URL, cookie: `${SESSION_COOKIE_NAME}=${opts.secret}` },
	});
	if (!res.ok) throw new Error(`start failed ${res.status}: ${await res.text()}`);
	if (!res.body) throw new Error("streaming response had no body");

	const reader = res.body.getReader();
	let done = false;
	const drained = (async () => {
		for (;;) {
			const chunk = await reader.read();
			if (chunk.done) break;
		}
		done = true;
	})();
	return { drained, isDone: () => done, cancel: () => reader.cancel() };
}

test("an attached run is visible in the database while it is still running", async ({
	api,
	db,
	session,
	mockOpenAI,
}) => {
	test.setTimeout(90_000);
	const { conversationId, rootMessageId } = await api.createConversation();
	await mockOpenAI.setScenario(conversationId, {
		content: Array.from({ length: 40 }, (_, i) => `w${i} `),
		chunkDelayMs: 500,
		finishReason: "stop",
	});

	const gen = await startAttachedGeneration({
		conversationId,
		parentId: rootMessageId,
		secret: session.secret,
		content: "attached visibility",
	});

	// Well before the run ends, and past a couple of materialisation windows.
	await new Promise((r) => setTimeout(r, 8000));
	expect(gen.isDone(), "run should still be in flight").toBe(false);

	const state = await readAssistant(db, conversationId);
	expect(state.generationId, "message should be stamped with its run").toBeTruthy();
	expect(state.content.length, "content must be readable mid-run by anyone").toBeGreaterThan(0);
	expect(state.materializedSeq ?? 0).toBeGreaterThan(0);

	await gen.drained;
});

test("materializedSeq describes exactly the content that was written", async ({
	api,
	db,
	session,
	mockOpenAI,
}) => {
	test.setTimeout(90_000);
	const { conversationId, rootMessageId } = await api.createConversation();
	await mockOpenAI.setScenario(conversationId, {
		content: Array.from({ length: 60 }, (_, i) => `w${i} `),
		chunkDelayMs: 300,
		finishReason: "stop",
	});

	const gen = await startAttachedGeneration({
		conversationId,
		parentId: rootMessageId,
		secret: session.secret,
		content: "cursor invariant",
	});

	// Sample repeatedly mid-run: an off-by-one here is the difference between a
	// clean reattach and one that duplicates or drops a span of tokens, and it is
	// invisible without this reconstruction.
	for (let i = 0; i < 5; i++) {
		await new Promise((r) => setTimeout(r, 2500));
		if (gen.isDone()) break;

		const state = await readAssistant(db, conversationId);
		if (!state.generationId || !state.materializedSeq) continue;

		const events = await readEvents(db, state.generationId);
		const replayed = events
			.filter((e) => e.seq <= (state.materializedSeq ?? 0))
			.map((e) => (e.event.type === "stream" ? e.event.token : ""))
			.join("");

		expect(
			replayed,
			`replaying events up to seq ${state.materializedSeq} must reproduce the stored content exactly`
		).toBe(state.content);
	}

	await gen.drained;
});

test("materialize persists the updates under the cursor, not only content", async ({
	api,
	db,
	session,
	mockOpenAI,
}) => {
	test.setTimeout(90_000);
	const { conversationId, rootMessageId } = await api.createConversation();
	await mockOpenAI.setScenario(conversationId, {
		content: Array.from({ length: 40 }, (_, i) => `w${i} `),
		chunkDelayMs: 400,
		finishReason: "stop",
	});

	const gen = await startAttachedGeneration({
		conversationId,
		parentId: rootMessageId,
		secret: session.secret,
		content: "updates under cursor",
	});

	// Mid-run the persisted message must already carry the updates covered by
	// materializedSeq — not an empty array. A reattaching viewer loads this array and
	// resumes strictly after the cursor, so anything missing here (tool/file/router
	// events ≤ the cursor) would be dropped for them and lost if the run then died.
	let sawUpdates = false;
	for (let i = 0; i < 8; i++) {
		await new Promise((r) => setTimeout(r, 1500));
		if (gen.isDone()) break;
		const state = await readAssistant(db, conversationId);
		if ((state.materializedSeq ?? 0) > 0 && (state.updates?.length ?? 0) > 0) {
			sawUpdates = true;
			break;
		}
	}
	expect(sawUpdates, "materialize must persist the updates array mid-run").toBe(true);

	await gen.drained;
});

test("event sequence numbers are contiguous and carry no keepalives", async ({
	api,
	db,
	session,
	mockOpenAI,
}) => {
	test.setTimeout(90_000);
	const { conversationId, rootMessageId } = await api.createConversation();
	await mockOpenAI.setScenario(conversationId, {
		content: Array.from({ length: 30 }, (_, i) => `w${i} `),
		chunkDelayMs: 100,
		finishReason: "stop",
	});

	const gen = await startAttachedGeneration({
		conversationId,
		parentId: rootMessageId,
		secret: session.secret,
		content: "sequence integrity",
	});
	await gen.drained;
	await new Promise((r) => setTimeout(r, 1500));

	const state = await readAssistant(db, conversationId);
	const generationId = state.generationId;
	if (!generationId) throw new Error("assistant message was not stamped with a generation id");
	const events = await readEvents(db, generationId);

	expect(events.length).toBeGreaterThan(0);
	expect(
		events.map((e) => e.seq),
		"seq must start at 1 and have no gaps or duplicates"
	).toEqual(events.map((_, i) => i + 1));

	// Keepalives fire every 100ms purely to hold the connection open. Logging them
	// would dominate the collection and tell a reader nothing.
	const keepalives = events.filter(
		(e) => e.event.type === "status" && "status" in e.event && e.event.status === "keepAlive"
	);
	expect(keepalives, "keepalives must not reach the log").toHaveLength(0);

	// Consecutive stream tokens are merged, so events stay far below one-per-token.
	const streamEvents = events.filter((e) => e.event.type === "stream");
	expect(streamEvents.length).toBeLessThan(30);
});

test("the run is marked completed and a second viewer renders it", async ({
	api,
	db,
	session,
	mockOpenAI,
	page,
}) => {
	test.setTimeout(90_000);
	const { conversationId, rootMessageId } = await api.createConversation();
	await mockOpenAI.setScenario(conversationId, {
		content: Array.from({ length: 30 }, (_, i) => `w${i} `),
		chunkDelayMs: 400,
		finishReason: "stop",
	});

	const gen = await startAttachedGeneration({
		conversationId,
		parentId: rootMessageId,
		secret: session.secret,
		content: "second viewer",
	});

	await new Promise((r) => setTimeout(r, 6000));
	expect(gen.isDone()).toBe(false);

	// The regression this whole phase exists for: another tab used to render "".
	await page.goto(`/conversation/${conversationId}`);
	await page.waitForTimeout(2000);
	const rendered = await page.locator('[data-message-role="assistant"]').last().innerText();
	expect(rendered.trim().length, "a second viewer must see the in-flight run").toBeGreaterThan(0);

	await gen.drained;
	await new Promise((r) => setTimeout(r, 1500));

	const state = await readAssistant(db, conversationId);
	const run = await db.collection("generations").findOne({ generationId: state.generationId });
	expect(run?.status).toBe("completed");
	expect(run?.endedAt).toBeTruthy();
	expect(state.materializedSeq).toBe(run?.seq);
});
