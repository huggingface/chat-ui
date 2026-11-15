/**
 * E2E coverage for the conversation scroll system: the anchored send and the
 * reservation's fill-phase stillness, in the real app. The detach and
 * re-attach rules are covered by the unit tests below: a wheel-then-jump e2e
 * test flaked on Linux WebKit, whose async scrolling snaps programmatic
 * scrolls back to a stale position after a wheel scroll.
 *
 * The behavioral spec lives in `src/lib/utils/scroll/__tests__` (unit
 * level); these tests pin the end-to-end wiring — turn groups, clearance
 * padding, the anchor latch — that only the full page exercises.
 */
import type { Page } from "playwright/test";
import { test, expect } from "./fixtures.ts";

const CONTAINER = '[aria-label="Conversation messages"]';
const ANCHOR_OFFSET_PX = 50;

/** Several viewports of history so the anchor position is reachable. The
 * seeded reply needs a terminal update, or the app reads it as a generation
 * still in flight and disables sending. */
const TALL_REPLY = `${"lorem ipsum dolor sit amet ".repeat(30)}\n\n`.repeat(8);
const TALL_HISTORY = [
	{ from: "system" as const, content: "" },
	{ from: "user" as const, content: "earlier question" },
	{
		from: "assistant" as const,
		content: TALL_REPLY,
		extra: { updates: [{ type: "finalAnswer", text: TALL_REPLY, interrupted: false }] },
	},
];

function containerGeometry(page: Page) {
	return page.evaluate((selector: string) => {
		const el = document.querySelector(selector);
		if (!(el instanceof HTMLElement)) throw new Error("scroll container not found");
		return { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight };
	}, CONTAINER);
}

test("send anchors the sent message and the reply fills reserved space without motion", async ({
	page,
	seedConversation,
	mockOpenAI,
}) => {
	// Slow enough to observe mid-stream geometry, short enough to stay inside
	// the reservation for the whole stream (~4s, a few lines of text).
	await mockOpenAI.setDefaultScenario({
		content: Array.from({ length: 60 }, (_, i) => `word${i} `),
		chunkDelayMs: 60,
		finishReason: "stop",
	});
	const id = await seedConversation({ title: "Scroll anchoring", messages: TALL_HISTORY });
	await page.goto(`/conversation/${id.toString()}`);
	await expect(page.getByText("earlier question")).toBeAttached();

	await page.getByPlaceholder("Ask anything").fill("anchor me");
	await page.getByRole("button", { name: "Send message" }).click();

	// The sent message glides to the anchor offset below the container top.
	const sent = page.locator('[data-message-type="user"]', { hasText: "anchor me" });
	await expect
		.poll(
			async () => {
				const [containerBox, sentBox] = await Promise.all([
					page.locator(CONTAINER).boundingBox(),
					sent.boundingBox(),
				]);
				if (!containerBox || !sentBox) return Number.NaN;
				return Math.abs(sentBox.y - containerBox.y - ANCHOR_OFFSET_PX);
			},
			{ timeout: 5000, message: "sent message reaches the anchor offset" }
		)
		.toBeLessThanOrEqual(2);

	// Mid-stream, the reply fills the reservation: page height and scroll
	// position are frozen while tokens keep arriving.
	const before = await containerGeometry(page);
	await page.waitForTimeout(800);
	const after = await containerGeometry(page);
	expect(after.scrollHeight).toBe(before.scrollHeight);
	expect(after.scrollTop).toBe(before.scrollTop);

	// …and the stream really was still running while we measured.
	await expect(page.locator('[data-message-role="assistant"]').last()).toContainText("word59", {
		timeout: 15_000,
	});
	const settled = await containerGeometry(page);
	expect(settled.scrollHeight).toBe(before.scrollHeight);
	expect(settled.scrollTop).toBe(before.scrollTop);
});
