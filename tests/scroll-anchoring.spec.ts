/**
 * E2E coverage for the conversation scroll system: the anchored send, the
 * reservation's fill-phase stillness, and the detach rule, in the real app.
 *
 * The behavioral spec lives in `src/lib/utils/scroll/__tests__` (unit
 * level); these tests pin the end-to-end wiring — turn groups, clearance
 * padding, the anchor latch — that only the full page exercises.
 */
import type { Page } from "playwright/test";
import { test, expect } from "./fixtures.ts";

const CONTAINER = '[aria-label="Conversation messages"]';
const ANCHOR_OFFSET_PX = 50;

// TEMPORARY diagnostics for the webkit jump-button flake.
test.beforeEach(async ({ page }) => {
	if (!process.env.SCROLL_DIAG) return;
	await page.addInitScript((selector: string) => {
		const log: string[] = [];
		(window as unknown as { __scrollLog: string[] }).__scrollLog = log;
		const t = () => performance.now().toFixed(1);
		const desc = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
		if (desc?.set && desc.get) {
			const get = desc.get;
			const set = desc.set;
			Object.defineProperty(Element.prototype, "scrollTop", {
				configurable: true,
				get() {
					return get.call(this);
				},
				set(v: number) {
					const before = get.call(this);
					set.call(this, v);
					if ((this as Element).matches?.(selector))
						log.push(
							`${t()} WRITE ${before.toFixed(1)} -> ${v.toFixed(1)} = ${get.call(this).toFixed(1)}`
						);
				},
			});
		}
		const hook = () => {
			const el = document.querySelector(selector);
			if (!(el instanceof HTMLElement)) return void setTimeout(hook, 50);
			el.addEventListener("scroll", () =>
				log.push(
					`${t()} SCROLL top=${el.scrollTop.toFixed(1)} h=${el.scrollHeight} ch=${el.clientHeight} anchor=${el.style.overflowAnchor}`
				)
			);
			for (const type of ["wheel", "mousedown", "mouseup", "click", "focusin", "focusout"])
				el.addEventListener(
					type,
					(e) => log.push(`${t()} ${type} target=${(e.target as Element).tagName}`),
					true
				);
			new MutationObserver((m) => log.push(`${t()} MUT x${m.length}`)).observe(el, {
				childList: true,
				subtree: true,
				characterData: true,
			});
		};
		document.addEventListener("DOMContentLoaded", hook);
	}, CONTAINER);
});

test.afterEach(async ({ page }, testInfo) => {
	if (!process.env.SCROLL_DIAG || testInfo.status === testInfo.expectedStatus) return;
	const log = await page.evaluate(
		() => (window as unknown as { __scrollLog: string[] }).__scrollLog ?? []
	);
	const body = log.slice(-600).join("\n");
	console.log(`SCROLL_DIAG_BEGIN\n${body}\nSCROLL_DIAG_END`);
});

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

test("read mode past the reservation, wheel-up stays put, the jump button re-engages following", async ({
	page,
	seedConversation,
	mockOpenAI,
}) => {
	// Long enough to outgrow the reservation and keep streaming well past the
	// measurement window below.
	await mockOpenAI.setDefaultScenario({
		content: Array.from({ length: 700 }, (_, i) => `token${i} `),
		chunkDelayMs: 40,
		finishReason: "stop",
	});
	const id = await seedConversation({ title: "Scroll detach", messages: TALL_HISTORY });
	await page.goto(`/conversation/${id.toString()}`);
	await expect(page.getByText("earlier question")).toBeAttached();

	await page.getByPlaceholder("Ask anything").fill("stream long");
	await page.getByRole("button", { name: "Send message" }).click();

	// Wait for the anchor to land, then for the reply to outgrow its
	// reservation by more than the jump button's threshold.
	const sent = page.locator('[data-message-type="user"]', { hasText: "stream long" });
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
	// Let the glide's final sub-pixel tick land before taking the baseline.
	let landed = await containerGeometry(page);
	await expect
		.poll(
			async () => {
				const now = await containerGeometry(page);
				const stable = now.scrollTop === landed.scrollTop;
				landed = now;
				return stable;
			},
			{ timeout: 5000, intervals: [150], message: "anchor glide settled" }
		)
		.toBe(true);
	const initial = landed;
	await expect
		.poll(async () => (await containerGeometry(page)).scrollHeight, {
			timeout: 15_000,
			message: "reply outgrows the reservation",
		})
		.toBeGreaterThan(initial.scrollHeight + 300);
	// Read mode: the page grew below the fold but the view did not move — the
	// beginning of the reply is still where the reader left it.
	const afterOutgrow = await containerGeometry(page);
	expect(Math.abs(afterOutgrow.scrollTop - initial.scrollTop)).toBeLessThanOrEqual(2); // sub-pixel rounding

	// Scroll up the way a user does — a real wheel gesture over the
	// conversation. (A bare scrollTop write is what the browser's own
	// adjustments look like and is deliberately not a detach.) Engines animate
	// wheel scrolling, so wait for the position to settle before measuring.
	const box = await page.locator(CONTAINER).boundingBox();
	if (!box) throw new Error("scroll container has no box");
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	const beforeWheel = (await containerGeometry(page)).scrollTop;
	await page.mouse.wheel(0, -400);
	// WebKit's wheel animation can pause a full frame budget between steps, so
	// "settled" means unchanged for a while, not two equal reads in a row.
	let settled = await containerGeometry(page);
	let settledSince = Date.now();
	await expect
		.poll(
			async () => {
				const now = await containerGeometry(page);
				if (now.scrollTop !== settled.scrollTop) {
					settled = now;
					settledSince = Date.now();
				}
				return now.scrollTop < beforeWheel && Date.now() - settledSince >= 600;
			},
			{ timeout: 5_000, intervals: [100], message: "wheel moved the view and it settled" }
		)
		.toBe(true);
	const variant = process.env.DIAG_VARIANT ?? "0";
	if (variant === "1") await page.waitForTimeout(1000);
	if (variant === "2")
		await page.evaluate(() => {
			(window as unknown as { __diagScrollTo: boolean }).__diagScrollTo = true;
		});
	if (variant === "3")
		await page.evaluate((selector: string) => {
			const el = document.querySelector(selector);
			if (el instanceof HTMLElement) el.scrollTop = el.scrollTop - 1;
		}, CONTAINER);

	const detached = await containerGeometry(page);
	await page.waitForTimeout(700); // many more chunks arrive
	const later = await containerGeometry(page);
	expect(later.scrollTop).toBe(detached.scrollTop); // the view is the user's
	// The window really sat mid-stream: the final token had not rendered yet…
	const rendered = await page.locator('[data-message-role="assistant"]').last().textContent();
	expect(rendered ?? "").not.toContain("token699");
	// …and the growth that arrived meanwhile never moved the detached view.
	expect(later.scrollHeight).toBeGreaterThan(detached.scrollHeight);

	// The jump-to-bottom button is the way back; it re-attaches to the live bottom.
	await page.evaluate(() =>
		(window as unknown as { __scrollLog?: string[] }).__scrollLog?.push(
			`${performance.now().toFixed(1)} ---- CLICK JUMP ----`
		)
	);
	await page.getByRole("button", { name: "Scroll to bottom" }).click();
	await expect
		.poll(
			async () => {
				const geometry = await page.evaluate((selector) => {
					const el = document.querySelector(selector);
					if (!(el instanceof HTMLElement)) throw new Error("scroll container not found");
					return {
						distance: el.scrollHeight - el.scrollTop - el.clientHeight,
					};
				}, CONTAINER);
				return geometry.distance;
			},
			{ timeout: 10_000, message: "jump button lands on the live bottom" }
		)
		.toBeLessThanOrEqual(2);
});
