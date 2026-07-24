/**
 * Characterization net for the conversation streaming UI (guards P3b's full rewrite).
 *
 * These assert OBSERVABLE behaviour, never the mechanism (polling vs reattach), so they must
 * pass both before P3b (poll + reload) and after it (reattach stream). They lock in the
 * behaviours the prod-incident comments in +page.svelte protect — above all that the
 * conversation never blanks or loses messages mid-stream — so the rewrite can't reintroduce
 * them silently.
 */
import { test, expect } from "./fixtures.ts";
import type { Page } from "playwright/test";
import { ObjectId } from "mongodb";

const SEND = { name: "Send message" };
const STOP = { name: "Stop generating" };

/** Long enough to observe / navigate / stop comfortably mid-stream. */
const slowStream = (tokens = 40, chunkDelayMs = 300) => ({
	content: Array.from({ length: tokens }, (_, i) => `word${i} `),
	chunkDelayMs,
	finishReason: "stop" as const,
});

async function assistantText(page: Page): Promise<string> {
	const loc = page.locator('[data-message-role="assistant"]').last();
	if ((await loc.count()) === 0) return "";
	return (await loc.innerText()).trim();
}

async function startConversation(page: Page, prompt: string): Promise<string> {
	await page.goto("/");
	await page.getByPlaceholder("Ask anything").fill(prompt);
	await page.getByRole("button", SEND).click();
	await page.waitForURL(/\/conversation\/[a-f0-9]{24}/);
	return page.url().split("/").pop() ?? "";
}

test("the conversation never blanks or shrinks mid-stream (prod incident 2026-06-11)", async ({
	page,
	mockOpenAI,
}) => {
	test.setTimeout(60_000);
	await mockOpenAI.setDefaultScenario(slowStream());
	await startConversation(page, "hello there");

	// Sample the assistant text as it streams. The regression this guards: a
	// mid-stream load refresh overwriting the locally-appended messages, blanking
	// the reply until the stream finished.
	let sawContent = false;
	let previousLength = 0;
	for (let i = 0; i < 25; i++) {
		const text = await assistantText(page);
		if (text.length > 0) sawContent = true;
		if (sawContent) {
			expect(text.length, `assistant text must never shrink (sample ${i})`).toBeGreaterThanOrEqual(
				previousLength
			);
			// The user's own message must stay on screen the whole time.
			await expect(page.getByLabel("Conversation messages").getByText("hello there")).toBeVisible();
		}
		previousLength = Math.max(previousLength, text.length);
		if (text.includes("word39")) break;
		await page.waitForTimeout(400);
	}

	expect(sawContent).toBe(true);
	await expect(page.locator('[data-message-role="assistant"]').last()).toContainText("word39");
});

test("stop generating shows while streaming and clears when done", async ({ page, mockOpenAI }) => {
	test.setTimeout(60_000);
	await mockOpenAI.setDefaultScenario(slowStream());
	await startConversation(page, "count for me");

	// Mid-stream: the stop control is present, the send control is not.
	await expect(page.getByRole("button", STOP)).toBeVisible();

	// After completion: send control returns, stop control gone.
	await expect(page.locator('[data-message-role="assistant"]').last()).toContainText("word39", {
		timeout: 30_000,
	});
	await expect(page.getByRole("button", SEND)).toBeVisible();
	await expect(page.getByRole("button", STOP)).toHaveCount(0);
});

test("stopping freezes the reply — it does not grow back after reload", async ({
	page,
	mockOpenAI,
}) => {
	test.setTimeout(60_000);
	await mockOpenAI.setDefaultScenario(slowStream(60, 250));
	const convId = await startConversation(page, "stop me midway");

	// Let a few words stream, then stop.
	await expect(page.locator('[data-message-role="assistant"]').last()).toContainText("word2", {
		timeout: 20_000,
	});
	await page.getByRole("button", STOP).click();

	// Freeze point.
	await page.waitForTimeout(1500);
	const atStop = await assistantText(page);
	expect(atStop.length).toBeGreaterThan(0);

	// It must not keep growing after the stop, and must survive a reload unchanged
	// (no "growing back" past what the user saw).
	await page.waitForTimeout(2500);
	expect((await assistantText(page)).length).toBeLessThanOrEqual(atStop.length + 8);

	await page.goto(`/conversation/${convId}`);
	await page.waitForTimeout(1500);
	const afterReload = await assistantText(page);
	expect(afterReload.length).toBeLessThanOrEqual(atStop.length + 8);
	// And it never resumes streaming after reload.
	await page.waitForTimeout(2500);
	expect(await assistantText(page)).toBe(afterReload);
});

test("leaving mid-stream and returning preserves the generation to completion", async ({
	page,
	mockOpenAI,
}) => {
	test.setTimeout(90_000);
	await mockOpenAI.setDefaultScenario(slowStream(50, 300)); // ~15s
	const convId = await startConversation(page, "long answer please");

	// Confirm it is genuinely mid-stream, then navigate away.
	await expect(page.locator('[data-message-role="assistant"]').last()).toContainText("word1", {
		timeout: 20_000,
	});
	await page.goto("/");
	await expect(page).toHaveURL(/\/$/);
	await page.waitForTimeout(6000);

	// Return: the reply must complete and be fully present, nothing lost.
	await page.goto(`/conversation/${convId}`);
	await expect(page.locator('[data-message-role="assistant"]').last()).toContainText("word49", {
		timeout: 40_000,
	});
	await expect(
		page.getByLabel("Conversation messages").getByText("long answer please")
	).toBeVisible();
});

test("a second viewer of a live generation sees it stream and complete", async ({
	page,
	context,
	mockOpenAI,
}) => {
	test.setTimeout(90_000);
	await mockOpenAI.setDefaultScenario(slowStream(40, 350)); // ~14s
	const convId = await startConversation(page, "two watchers");

	// Second page in the same (logged-in) context opens the conversation mid-stream.
	await expect(page.locator('[data-message-role="assistant"]').last()).toContainText("word1", {
		timeout: 20_000,
	});
	const page2 = await context.newPage();
	await page2.goto(`/conversation/${convId}`);

	// It must show partial content and then reach completion, without the starter tab.
	await expect(page2.locator('[data-message-role="assistant"]').last()).toContainText("word", {
		timeout: 20_000,
	});
	await expect(page2.locator('[data-message-role="assistant"]').last()).toContainText("word39", {
		timeout: 40_000,
	});
	await page2.close();
});

test("a freshly loaded finished conversation renders without a stop control", async ({
	page,
	seedConversation,
}) => {
	test.setTimeout(30_000);
	const id = await seedConversation({
		messages: [
			{ from: "system", content: "" },
			{ from: "user", content: "already done" },
			// A real finished message carries a terminal update; without one the UI
			// (correctly) treats it as still generating.
			{
				from: "assistant",
				content: "a complete answer",
				extra: { updates: [{ type: "status", status: "finished" }] },
			},
		],
	});
	await page.goto(`/conversation/${id.toString()}`);
	await expect(page.locator('[data-message-role="assistant"]').last()).toContainText(
		"a complete answer"
	);
	// A terminal conversation must not present as generating.
	await expect(page.getByRole("button", STOP)).toHaveCount(0);
	await expect(page.getByRole("button", SEND)).toBeVisible();
});

test("retrying an assistant message generates a fresh reply", async ({
	page,
	db,
	session,
	mockOpenAI,
}) => {
	test.setTimeout(60_000);
	const id = await seedForRetry(db, session.sessionId);
	await mockOpenAI.setScenario(id, {
		content: ["A ", "brand ", "new ", "answer."],
		chunkDelayMs: 20,
		finishReason: "stop",
	});

	await page.goto(`/conversation/${id}`);
	await expect(page.locator('[data-message-role="assistant"]').last()).toContainText("old answer");

	// Hover the assistant message to reveal its actions, then retry.
	const assistant = page.locator('[data-message-role="assistant"]').last();
	await assistant.hover();
	await page.getByTitle("Retry").first().click();

	await expect(page.locator('[data-message-role="assistant"]').last()).toContainText(
		"brand new answer",
		{ timeout: 30_000 }
	);
});

// Retry needs a real message-id tree; seedConversation builds one, but we need the id back.
async function seedForRetry(db: import("mongodb").Db, sessionId: string): Promise<string> {
	const { randomUUID } = await import("node:crypto");
	const now = new Date();
	const s = randomUUID();
	const u = randomUUID();
	const a = randomUUID();
	const _id = new ObjectId();
	await db.collection("conversations").insertOne({
		_id,
		sessionId,
		model: "test-org/test-model",
		title: "retry seed",
		rootMessageId: s,
		messages: [
			{ id: s, from: "system", content: "", ancestors: [], children: [u] },
			{ id: u, from: "user", content: "ask again", ancestors: [s], children: [a] },
			{
				id: a,
				from: "assistant",
				content: "old answer",
				updates: [{ type: "status", status: "finished" }],
				ancestors: [s, u],
				children: [],
			},
		],
		createdAt: now,
		updatedAt: now,
	} as never);
	return _id.toString();
}
