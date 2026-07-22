/**
 * Canary for the e2e harness, not a feature suite — keep it small. Feature coverage belongs in
 * the per-area specs.
 */
import { test, expect } from "./fixtures.ts";

const PLAIN_TEXT_REPLY = "Hello from the mock server.";

test("sends a message, streams a reply, and persists it", async ({
	page,
	db,
	session,
	mockOpenAI,
}) => {
	await mockOpenAI.setDefaultScenario("plainText");

	await page.goto("/");

	await page.getByPlaceholder("Ask anything").fill("hello mock");
	await page.getByRole("button", { name: "Send message" }).click();

	await page.waitForURL(/\/conversation\/[a-f0-9]{24}/);
	const conversationUrl = page.url();
	const conversationId = conversationUrl.split("/").pop() ?? "";

	const assistant = page.locator('[data-message-role="assistant"]').last();
	await expect(assistant).toContainText(PLAIN_TEXT_REPLY);

	// Proves the streaming path, not a one-shot completion.
	const upstream = await mockOpenAI.requests();
	const streamed = upstream.filter((r) => r.path === "/v1/chat/completions" && r.stream);
	expect(streamed.length).toBeGreaterThan(0);

	await expect
		.poll(async () => {
			const conv = await db.collection("conversations").findOne({ sessionId: session.sessionId });
			return conv?.messages?.some(
				(m: { from: string; content: string }) =>
					m.from === "assistant" && m.content.includes(PLAIN_TEXT_REPLY)
			);
		})
		.toBe(true);

	await page.reload();
	await expect(page.locator('[data-message-role="assistant"]').last()).toContainText(
		PLAIN_TEXT_REPLY
	);
	expect(page.url()).toContain(conversationId);
});

test("renders a conversation seeded directly into Mongo", async ({ page, seedConversation }) => {
	const id = await seedConversation({
		title: "Seeded smoke conversation",
		messages: [
			{ from: "system", content: "" },
			{ from: "user", content: "seeded question" },
			{ from: "assistant", content: "seeded answer" },
		],
	});

	await page.goto(`/conversation/${id.toString()}`);

	await expect(page.locator('[data-message-role="assistant"]').last()).toContainText(
		"seeded answer"
	);
	await expect(page.getByText("seeded question")).toBeVisible();
});
