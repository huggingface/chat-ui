/**
 * Sidebar generation liveness (P4).
 *
 * A generation running in a conversation you are NOT viewing shows a live indicator on
 * its sidebar row (fed by /api/v2/generations/live) and raises a completion toast when it
 * finishes in the background. Drives the real UI, flipping the generation's DB status to
 * simulate a run completing elsewhere.
 */
import { test, expect } from "./fixtures.ts";
import { ObjectId, type Db } from "mongodb";
import { randomUUID } from "node:crypto";

async function seedRunning(
	db: Db,
	sessionId: string,
	title: string
): Promise<{ convId: string; generationId: string }> {
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
		title,
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
		status: "running",
		seq: 1,
		lastHeartbeatAt: now,
		startedAt: now,
		createdAt: now,
		updatedAt: now,
	} as never);

	return { convId: conversationId.toString(), generationId };
}

test("a background run shows a sidebar indicator and toasts on completion", async ({
	page,
	db,
	session,
}) => {
	test.setTimeout(60_000);
	const { generationId } = await seedRunning(db, session.sessionId, "background job");

	// Land on home — not viewing the generating conversation.
	await page.goto("/");

	// Its sidebar row shows the live generating indicator.
	await expect(page.getByLabel("Generating").first()).toBeVisible({ timeout: 20_000 });

	// Complete the run server-side; the feed reports it ended on the next tick.
	await db
		.collection("generations")
		.updateOne(
			{ generationId },
			{ $set: { status: "completed", endedAt: new Date(), updatedAt: new Date() } }
		);

	// A completion toast appears (we are not viewing that conversation)...
	await expect(page.getByText("Response ready")).toBeVisible({ timeout: 20_000 });
	// ...and the indicator clears.
	await expect(page.getByLabel("Generating")).toHaveCount(0, { timeout: 20_000 });
});

test("no toast fires for the conversation you are currently viewing", async ({
	page,
	db,
	session,
}) => {
	test.setTimeout(60_000);
	const { convId, generationId } = await seedRunning(db, session.sessionId, "viewed job");

	// View the generating conversation itself.
	await page.goto(`/conversation/${convId}`);
	// Let the live feed observe it running at least once.
	await page.waitForTimeout(3000);

	await db
		.collection("generations")
		.updateOne(
			{ generationId },
			{ $set: { status: "completed", endedAt: new Date(), updatedAt: new Date() } }
		);

	// The page owns this conversation's completion, so the background toast is suppressed.
	await page.waitForTimeout(6000);
	await expect(page.getByText("Response ready")).toHaveCount(0);
});
