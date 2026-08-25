import { afterEach, describe, expect, it } from "vitest";
import { StickToBottomController, type StickToBottomOptions } from "../stickToBottom";
import {
	browserScrollTo,
	createFixture,
	dragScrollbarTo,
	frame,
	frames,
	mulberry32,
	nextTask,
	pinch,
	pressKey,
	startClsProbe,
	stream,
	touchDrag,
	waitFor,
	wheel,
	type Fixture,
} from "./harness";

/** Distance considered "arrived" — mirrors the controller's AT_BOTTOM_EPS. */
const ARRIVED = 2;

let cleanups: (() => void)[] = [];

function setup(
	fixtureOpts: Parameters<typeof createFixture>[0] = {},
	controllerOpts: StickToBottomOptions = {}
): { fixture: Fixture; controller: StickToBottomController } {
	const fixture = createFixture({
		viewportHeight: 400,
		blocks: [{ height: 300, user: true }, { height: 300 }, { height: 300, user: true }],
		...fixtureOpts,
	});
	const controller = new StickToBottomController(fixture.container, {
		content: () => fixture.content,
		...controllerOpts,
	});
	controller.jumpToBottom();
	cleanups.push(() => {
		controller.destroy();
		fixture.destroy();
	});
	return { fixture, controller };
}

afterEach(() => {
	for (const cleanup of cleanups) cleanup();
	cleanups = [];
});

describe("mount & basic follow", () => {
	it("lands at the bottom immediately on jumpToBottom, pinned", () => {
		const { fixture, controller } = setup();
		expect(fixture.distance()).toBeLessThanOrEqual(ARRIVED);
		expect(controller.pinned).toBe(true);
	});

	it("growth snaps to the bottom on the next frame — never a glide", async () => {
		const { fixture, controller } = setup();
		// Snap = ResizeObserver delivery + one tick (a few frames); a spring from
		// 700px away cannot get within 2px in 6 ticks in any rAF regime.
		fixture.growLast(700);
		await waitFor(() => fixture.distance() <= ARRIVED, {
			maxFrames: 6,
			label: "snaps to the bottom",
		});
		expect(controller.pinned).toBe(true);
	});

	it("stays glued through continuous rAF-cadence streaming with bounded lag", async () => {
		const { fixture } = setup();
		let maxLag = 0;
		await stream(fixture, { pxPerFrame: 8, frameCount: 60 }, () => {
			maxLag = Math.max(maxLag, fixture.distance());
		});
		await waitFor(() => fixture.distance() <= ARRIVED, { label: "settles after stream" });
		// Snap follows lag at most a frame or two of growth — nothing like the
		// old spring's elastic gap.
		expect(maxLag).toBeLessThan(40);
	});

	it("re-pins to the live bottom when the container itself resizes", async () => {
		const { fixture } = setup();
		fixture.container.style.height = "300px";
		await waitFor(() => fixture.distance() <= ARRIVED, { label: "follows container resize" });
	});
});

describe("detach on user intent", () => {
	it("wheel up unpins; content keeps growing without moving the view", async () => {
		const { fixture, controller } = setup();
		wheel(fixture.container, -120);
		await frame();
		expect(controller.pinned).toBe(false);
		const top = fixture.scrollTop();
		fixture.growLast(600);
		await frames(4);
		expect(fixture.scrollTop()).toBe(top);
		expect(controller.pinned).toBe(false);
	});

	it("accumulated upward drift below the threshold keeps following; crossing it detaches", async () => {
		const { fixture, controller } = setup();
		// Let the initial ResizeObserver delivery settle so its follow can't
		// interleave with the sub-threshold wheels below.
		await frames(3);
		await nextTask();
		wheel(fixture.container, -2);
		await frame();
		expect(controller.pinned).toBe(true);
		wheel(fixture.container, -2);
		await frame();
		expect(controller.pinned).toBe(false);
	});

	it("wheel up halts a running glide immediately (the user always wins the fight)", async () => {
		const { fixture, controller } = setup();
		fixture.addBlock(1200);
		await waitFor(() => fixture.distance() <= ARRIVED, { label: "settle tall fixture" });
		await nextTask();
		dragScrollbarTo(fixture.container, 0);
		await frame();
		controller.animateToBottom();
		await frames(3); // glide in flight
		const before = fixture.scrollTop();
		wheel(fixture.container, -120);
		await frames(3);
		expect(controller.pinned).toBe(false);
		// Only our emulated wheel default moved the view — no further catch-up.
		expect(fixture.scrollTop()).toBeLessThanOrEqual(before - 120 + 1);
	});

	it("a touch drag during a glide takes the view (glide canceled)", async () => {
		const { fixture, controller } = setup();
		fixture.addBlock(1200);
		await waitFor(() => fixture.distance() <= ARRIVED, { label: "settle tall fixture" });
		await nextTask();
		dragScrollbarTo(fixture.container, 0);
		await frame();
		controller.animateToBottom();
		await frames(2); // glide in flight
		await touchDrag(fixture.container, { fromY: 100, toY: 220 });
		expect(controller.pinned).toBe(false);
		const top = fixture.scrollTop();
		await frames(3);
		expect(fixture.scrollTop()).toBe(top);
	});

	it("scrollbar drag up unpins (no wheel/touch involved — position is the signal)", async () => {
		const { fixture, controller } = setup();
		dragScrollbarTo(fixture.container, fixture.scrollTop() - 200);
		await frame();
		expect(controller.pinned).toBe(false);
	});

	it("PageUp unpins through its own scroll — no keyboard handler needed", async () => {
		const { fixture, controller } = setup();
		pressKey(fixture.container, "PageUp");
		await frame();
		expect(controller.pinned).toBe(false);
	});

	it("touch drag toward earlier content unpins", async () => {
		const { fixture, controller } = setup();
		await touchDrag(fixture.container, { fromY: 100, toY: 260 });
		expect(controller.pinned).toBe(false);
	});

	it("keydown inside an input does not unpin", async () => {
		const { fixture, controller } = setup();
		const input = document.createElement("input");
		fixture.content.appendChild(input);
		await frames(2);
		await waitFor(() => fixture.distance() <= ARRIVED, { label: "settle after append" });
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
		await frame();
		expect(controller.pinned).toBe(true);
	});
});

describe("gestures that must NOT change pin state", () => {
	it("ctrl+wheel (pinch zoom) is ignored", async () => {
		const { fixture, controller } = setup();
		wheel(fixture.container, -200, { ctrlKey: true });
		await frame();
		expect(controller.pinned).toBe(true);
	});

	it("a two-finger touch pinch is not scroll intent", async () => {
		const { fixture, controller } = setup();
		await pinch(fixture.container, { spread: 100 });
		expect(controller.pinned).toBe(true);
	});

	it("keydown already consumed by a widget (defaultPrevented) is ignored", async () => {
		const { fixture, controller } = setup();
		fixture.container.addEventListener("keydown", (e) => e.preventDefault(), {
			capture: true,
			once: true,
		});
		fixture.container.dispatchEvent(
			new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true })
		);
		await frame();
		expect(controller.pinned).toBe(true);
	});

	it("dominantly horizontal trackpad pans are ignored", async () => {
		const { fixture, controller } = setup();
		wheel(fixture.container, -4, { deltaX: -90, noScroll: true });
		await frame();
		expect(controller.pinned).toBe(true);
	});

	it("wheel up consumed by an inner scrollable does not unpin", async () => {
		const { fixture, controller } = setup();
		const inner = document.createElement("div");
		inner.style.cssText = "height: 100px; overflow-y: auto; flex-shrink: 0;";
		const innerContent = document.createElement("div");
		innerContent.style.height = "500px";
		inner.appendChild(innerContent);
		fixture.content.appendChild(inner);
		await frames(2);
		await waitFor(() => fixture.distance() <= ARRIVED, { label: "settle after append" });
		inner.scrollTop = 200; // the code block can scroll up on its own
		await frame();
		// The inner scroller consumes the wheel: the conversation never moves,
		// so there is no upward movement to read as intent.
		wheel(fixture.container, -120, { target: inner, noScroll: true });
		await frame();
		expect(controller.pinned).toBe(true);
	});

	it("a wheel up consumed by an inner scroller does not cancel a glide", async () => {
		const { fixture, controller } = setup();
		const inner = document.createElement("div");
		inner.style.cssText = "height: 100px; overflow-y: auto; flex-shrink: 0;";
		const innerContent = document.createElement("div");
		innerContent.style.height = "500px";
		inner.appendChild(innerContent);
		fixture.content.appendChild(inner);
		fixture.addBlock(1200);
		await waitFor(() => fixture.distance() <= ARRIVED, { label: "settle tall fixture" });
		inner.scrollTop = 200; // the tool output / code block can scroll up on its own
		await nextTask();
		dragScrollbarTo(fixture.container, 0);
		await frame();
		controller.animateToBottom();
		await frames(2); // glide in flight
		wheel(fixture.container, -120, { target: inner, noScroll: true });
		await frames(2);
		expect(controller.pinned).toBe(true);
		await waitFor(() => fixture.distance() <= ARRIVED, { label: "glide still completes" });
	});

	it("a touch drag inside an inner scroller does not cancel a glide", async () => {
		const { fixture, controller } = setup();
		const inner = document.createElement("div");
		inner.style.cssText = "height: 100px; overflow-y: auto; flex-shrink: 0;";
		const innerContent = document.createElement("div");
		innerContent.style.height = "500px";
		inner.appendChild(innerContent);
		fixture.content.appendChild(inner);
		fixture.addBlock(1200);
		await waitFor(() => fixture.distance() <= ARRIVED, { label: "settle tall fixture" });
		inner.scrollTop = 200;
		await nextTask();
		dragScrollbarTo(fixture.container, 0);
		await frame();
		await new Promise((resolve) => setTimeout(resolve, 250)); // let the drag's gesture window lapse
		controller.animateToBottom();
		await frames(2);
		await touchDrag(fixture.container, { fromY: 100, toY: 220, target: inner, noScroll: true });
		expect(controller.pinned).toBe(true);
		await waitFor(() => fixture.distance() <= ARRIVED, { label: "glide still completes" });
	});

	it("a touch starting in the edge-swipe zone never cancels a glide", async () => {
		const { fixture, controller } = setup({}, { ignoreTouchZonePx: 40 });
		fixture.addBlock(1200);
		await waitFor(() => fixture.distance() <= ARRIVED, { label: "settle tall fixture" });
		await nextTask();
		dragScrollbarTo(fixture.container, 0);
		await frame();
		await new Promise((resolve) => setTimeout(resolve, 250));
		controller.animateToBottom();
		await frames(2);
		// The drawer claims this touch and prevents it from scrolling anything.
		await touchDrag(fixture.container, { fromY: 100, toY: 220, x: 30, noScroll: true });
		expect(controller.pinned).toBe(true);
		await waitFor(() => fixture.distance() <= ARRIVED, { label: "glide still completes" });
	});

	it("a mostly-horizontal drag with slight vertical drift does not cancel a glide", async () => {
		const { fixture, controller } = setup();
		fixture.addBlock(1200);
		await waitFor(() => fixture.distance() <= ARRIVED, { label: "settle tall fixture" });
		await nextTask();
		dragScrollbarTo(fixture.container, 0);
		await frame();
		await new Promise((resolve) => setTimeout(resolve, 250));
		controller.animateToBottom();
		await frames(2);
		const el = fixture.container;
		const id = 777;
		const touch = (type: string, x: number, y: number) =>
			el.dispatchEvent(
				new TouchEvent(type, {
					touches:
						type === "touchend"
							? []
							: [new Touch({ identifier: id, target: el, clientX: x, clientY: y })],
					changedTouches: [new Touch({ identifier: id, target: el, clientX: x, clientY: y })],
					bubbles: true,
				})
			);
		touch("touchstart", 100, 200);
		touch("touchmove", 140, 203); // 40px right, 3px down
		touch("touchmove", 180, 206);
		touch("touchend", 180, 206);
		await frames(2);
		expect(controller.pinned).toBe(true);
		await waitFor(() => fixture.distance() <= ARRIVED, { label: "glide still completes" });
	});

	it("a wheel down during a glide does not cancel it", async () => {
		const { fixture, controller } = setup();
		fixture.addBlock(1200);
		await waitFor(() => fixture.distance() <= ARRIVED, { label: "settle tall fixture" });
		await nextTask();
		dragScrollbarTo(fixture.container, 0);
		await frame();
		controller.animateToBottom();
		await frames(2);
		wheel(fixture.container, 60); // helping toward the bottom
		await waitFor(() => fixture.distance() <= ARRIVED, { label: "glide still completes" });
		expect(controller.pinned).toBe(true);
	});

	it("content shrink while pinned stays clamped at the bottom, still pinned", async () => {
		const { fixture, controller } = setup();
		fixture.setLastHeight(20);
		await frames(3);
		expect(controller.pinned).toBe(true);
		await waitFor(() => fixture.distance() <= ARRIVED, { label: "stays at bottom" });
	});

	it("shrink far below a detached reader leaves them stationary and unpinned", async () => {
		const { fixture, controller } = setup();
		fixture.addBlock(1200);
		await waitFor(() => fixture.distance() <= ARRIVED, { label: "settle" });
		await nextTask(); // input from task context, like real input
		// Read far above the end: the coming shrink cannot clamp this position.
		dragScrollbarTo(fixture.container, 100);
		await frame();
		expect(controller.pinned).toBe(false);
		fixture.removeLast();
		await frames(3);
		expect(controller.pinned).toBe(false);
		expect(fixture.scrollTop()).toBe(100);
	});

	it("shrink that clamps the view to the bottom resumes following", async () => {
		const { fixture, controller } = setup();
		fixture.addBlock(800);
		await waitFor(() => fixture.distance() <= ARRIVED, { label: "settle" });
		wheel(fixture.container, -50);
		await frame();
		expect(controller.pinned).toBe(false);
		// Shrink below the current scroll position -> the browser clamps the
		// view to the new exact bottom. There is nothing below to read, so the
		// controller re-engages (a reasoning-collapse or keyboard-close clamp
		// must not leave the stream running below the fold).
		fixture.removeLast();
		await frames(3);
		expect(fixture.scrollTop()).toBe(fixture.maxScrollTop());
		expect(controller.pinned).toBe(true);
		fixture.growLast(400);
		await waitFor(() => fixture.distance() <= ARRIVED, { label: "follows after clamp" });
	});

	it("a native scroll-anchoring adjustment while detached is not read as user input", async () => {
		const { fixture, controller } = setup();
		// Detach just inside the near-bottom zone: a misclassified downward
		// "user scroll" here is exactly what would trigger a spurious re-pin.
		wheel(fixture.container, -50);
		await frame();
		expect(controller.pinned).toBe(false);
		const distanceBefore = fixture.distance();
		// Content grows ABOVE the viewport (late image, markdown swap). With
		// the controller unpinned, overflow-anchor is re-enabled and Chrome
		// compensates scrollTop — scrollTop and scrollHeight move together,
		// distance stays constant. That downward scroll event must not re-pin.
		(fixture.content.firstElementChild as HTMLElement).style.height = "600px";
		await frames(3);
		expect(controller.pinned).toBe(false);
		// And when anchoring fired, the reading position was preserved too.
		if (Math.abs(fixture.distance() - distanceBefore) <= 2) {
			expect(fixture.distance()).toBeGreaterThan(40);
		}
	});
});

describe("browser-initiated movement (no gesture)", () => {
	it("an upward move with no gesture behind it is undone in the same event while following", async () => {
		const { fixture, controller } = setup();
		await frames(3);
		await nextTask();
		// Safari clamps the scroller while DOM nodes are swapped and reports it
		// as a scroll event; nothing the user did produced this — the DOM did.
		fixture.lastBlock().replaceWith(fixture.lastBlock().cloneNode(true));
		browserScrollTo(fixture.container, fixture.scrollTop() - 200);
		await frame();
		expect(controller.pinned).toBe(true);
		expect(fixture.distance()).toBeLessThanOrEqual(ARRIVED);
	});

	it("a stationary press on message text is not a gesture: a following view still undoes a clamp", async () => {
		const { fixture, controller } = setup();
		await frames(3);
		await nextTask();
		// Mouse down on ordinary content (a click, or a selection about to
		// start) — then Safari's per-token clamp lands.
		fixture
			.lastBlock()
			.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 100, clientY: 200 }));
		fixture.lastBlock().replaceWith(fixture.lastBlock().cloneNode(true));
		browserScrollTo(fixture.container, fixture.scrollTop() - 200);
		await frame();
		expect(controller.pinned).toBe(true);
		expect(fixture.distance()).toBeLessThanOrEqual(ARRIVED);
		window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
	});

	it("a press that drags (a text selection auto-scrolling up) is the user's and detaches", async () => {
		const { fixture, controller } = setup();
		await frames(3);
		await nextTask();
		fixture
			.lastBlock()
			.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 100, clientY: 200 }));
		fixture
			.lastBlock()
			.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 100, clientY: 170 }));
		fixture.lastBlock().replaceWith(fixture.lastBlock().cloneNode(true));
		browserScrollTo(fixture.container, fixture.scrollTop() - 200);
		await frame();
		expect(controller.pinned).toBe(false);
		window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
	});

	it("a downward wheel at the bottom is not upward intent: a following view still undoes a clamp", async () => {
		const { fixture, controller } = setup();
		await frames(3);
		await nextTask();
		wheel(fixture.container, 120); // the reflex while watching a stream at the bottom
		fixture.lastBlock().replaceWith(fixture.lastBlock().cloneNode(true));
		browserScrollTo(fixture.container, fixture.scrollTop() - 200);
		await frame();
		expect(controller.pinned).toBe(true);
		expect(fixture.distance()).toBeLessThanOrEqual(ARRIVED);
	});

	it("a tap (touch that never moves) is not a gesture: a following view still undoes a clamp", async () => {
		const { fixture, controller } = setup();
		await frames(3);
		await nextTask();
		const el = fixture.container;
		const tap = (type: string) =>
			el.dispatchEvent(
				new TouchEvent(type, {
					touches:
						type === "touchend"
							? []
							: [new Touch({ identifier: 9, target: el, clientX: 100, clientY: 200 })],
					changedTouches: [new Touch({ identifier: 9, target: el, clientX: 100, clientY: 200 })],
					bubbles: true,
				})
			);
		tap("touchstart");
		tap("touchend");
		fixture.lastBlock().replaceWith(fixture.lastBlock().cloneNode(true));
		browserScrollTo(fixture.container, fixture.scrollTop() - 200);
		await frame();
		expect(controller.pinned).toBe(true);
		expect(fixture.distance()).toBeLessThanOrEqual(ARRIVED);
	});

	it("a horizontal swipe held on content is not upward intent: a clamp while the finger is down is undone", async () => {
		const { fixture, controller } = setup();
		await frames(3);
		await nextTask();
		const el = fixture.container;
		const touch = (type: string, clientX: number, clientY: number) =>
			el.dispatchEvent(
				new TouchEvent(type, {
					touches:
						type === "touchend" ? [] : [new Touch({ identifier: 7, target: el, clientX, clientY })],
					changedTouches: [new Touch({ identifier: 7, target: el, clientX, clientY })],
					bubbles: true,
				})
			);
		touch("touchstart", 100, 200);
		touch("touchmove", 160, 201); // swiping a code block sideways
		touch("touchmove", 220, 203);
		fixture.lastBlock().replaceWith(fixture.lastBlock().cloneNode(true));
		browserScrollTo(fixture.container, fixture.scrollTop() - 200);
		await frame();
		expect(controller.pinned).toBe(true);
		expect(fixture.distance()).toBeLessThanOrEqual(ARRIVED);
		touch("touchend", 220, 203);
	});

	it("a finger swiping up at the bottom (asking for more while following) is not upward intent: a clamp is undone", async () => {
		const { fixture, controller } = setup();
		await frames(3);
		await nextTask();
		const el = fixture.container;
		const touch = (type: string, clientY: number) =>
			el.dispatchEvent(
				new TouchEvent(type, {
					touches:
						type === "touchend"
							? []
							: [new Touch({ identifier: 8, target: el, clientX: 100, clientY })],
					changedTouches: [new Touch({ identifier: 8, target: el, clientX: 100, clientY })],
					bubbles: true,
				})
			);
		touch("touchstart", 300);
		touch("touchmove", 260); // finger up = content down: nothing below to show
		touch("touchmove", 220);
		fixture.lastBlock().replaceWith(fixture.lastBlock().cloneNode(true));
		browserScrollTo(fixture.container, fixture.scrollTop() - 200);
		await frame();
		expect(controller.pinned).toBe(true);
		expect(fixture.distance()).toBeLessThanOrEqual(ARRIVED);
		touch("touchend", 220);
	});

	it("keys typed into an editable field inside the scroller are not gestures: a clamp is still undone", async () => {
		const { fixture, controller } = setup();
		const textarea = document.createElement("textarea");
		fixture.content.appendChild(textarea);
		await frames(2);
		await waitFor(() => fixture.distance() <= ARRIVED, { label: "settle after append" });
		await nextTask();
		textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
		fixture.lastBlock().replaceWith(fixture.lastBlock().cloneNode(true));
		browserScrollTo(fixture.container, fixture.scrollTop() - 200);
		await frame();
		expect(controller.pinned).toBe(true);
		expect(fixture.distance()).toBeLessThanOrEqual(ARRIVED);
	});

	it("a key that cannot scroll (a letter on the scroller) is not a gesture: a clamp is still undone", async () => {
		const { fixture, controller } = setup();
		await frames(3);
		await nextTask();
		fixture.container.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
		fixture.lastBlock().replaceWith(fixture.lastBlock().cloneNode(true));
		browserScrollTo(fixture.container, fixture.scrollTop() - 200);
		await frame();
		expect(controller.pinned).toBe(true);
		expect(fixture.distance()).toBeLessThanOrEqual(ARRIVED);
	});

	it("PageUp from a control focused inside the scroller is the user's scroll, even mid-stream", async () => {
		const { fixture, controller } = setup();
		const button = document.createElement("button");
		button.textContent = "copy";
		fixture.content.appendChild(button);
		await frames(2);
		await waitFor(() => fixture.distance() <= ARRIVED, { label: "settle after append" });
		button.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp", bubbles: true }));
		fixture.content.firstElementChild?.replaceWith(fixture.content.children[0].cloneNode(true)); // content is active
		browserScrollTo(fixture.container, fixture.scrollTop() - fixture.container.clientHeight * 0.9);
		await frame();
		expect(controller.pinned).toBe(false);
		expect(fixture.distance()).toBeGreaterThan(150);
	});

	it("a quiet browser navigation while following (find-in-page) detaches and keeps its place", async () => {
		const { fixture, controller } = setup();
		await frames(3);
		await new Promise((resolve) => setTimeout(resolve, 250)); // nothing changes in the DOM
		browserScrollTo(fixture.container, fixture.scrollTop() - 200);
		await frame();
		expect(controller.pinned).toBe(false);
		expect(fixture.distance()).toBeGreaterThan(150);
		const top = fixture.scrollTop();
		fixture.growLast(300);
		await frames(3);
		expect(fixture.scrollTop()).toBe(top);
	});

	it("the same move while detached is left alone (find-in-page keeps its result in view)", async () => {
		const { fixture, controller } = setup();
		wheel(fixture.container, -120);
		await frame();
		expect(controller.pinned).toBe(false);
		await nextTask();
		browserScrollTo(fixture.container, 40);
		await frames(2);
		expect(controller.pinned).toBe(false);
		expect(fixture.scrollTop()).toBe(40);
	});

	it("a flick's momentum keeps its place while detached, even as content changes", async () => {
		const { fixture, controller } = setup();
		await frames(3); // let the initial ResizeObserver settle
		await nextTask();
		await touchDrag(fixture.container, { fromY: 100, toY: 160 });
		expect(controller.pinned).toBe(false);
		// Momentum after the lift: scroll events with no touch events behind
		// them, landing while the stream keeps changing the DOM.
		fixture.lastBlock().replaceWith(fixture.lastBlock().cloneNode(true));
		const before = fixture.scrollTop();
		browserScrollTo(fixture.container, before - 60);
		await frame();
		expect(controller.pinned).toBe(false);
		expect(fixture.scrollTop()).toBe(before - 60);
	});

	it("a browser-initiated move during a following glide lands it at the bottom at once", async () => {
		const { fixture, controller } = setup();
		fixture.addBlock(1200);
		await waitFor(() => fixture.distance() <= ARRIVED, { label: "settle tall fixture" });
		await nextTask();
		dragScrollbarTo(fixture.container, 0);
		await frame();
		// Let the drag's gesture window lapse: the move below must carry none.
		await new Promise((resolve) => setTimeout(resolve, 250));
		controller.animateToBottom();
		await frames(2);
		const mid = fixture.scrollTop();
		// A streaming token's re-render: the DOM changes, and Safari clamps.
		fixture.lastBlock().replaceWith(fixture.lastBlock().cloneNode(true));
		browserScrollTo(fixture.container, mid - 30);
		await frames(2);
		// Still pinned; rather than nursing the spring through a stream's
		// per-token clamps (Safari), the move is answered by landing at the
		// bottom immediately.
		expect(controller.pinned).toBe(true);
		expect(fixture.distance()).toBeLessThanOrEqual(ARRIVED);
	});
});

describe("re-attach", () => {
	it("scrollbar drag back to the bottom re-pins", async () => {
		const { fixture, controller } = setup();
		wheel(fixture.container, -400);
		await frame();
		expect(controller.pinned).toBe(false);
		dragScrollbarTo(fixture.container, fixture.maxScrollTop());
		await frame();
		expect(controller.pinned).toBe(true);
	});

	it("wheel down into the near-bottom zone re-pins and catches up with growth", async () => {
		const { fixture, controller } = setup();
		wheel(fixture.container, -300);
		await frame();
		fixture.growLast(200); // content that arrived while detached
		await frames(2);
		while (fixture.distance() > 40) {
			wheel(fixture.container, 120);
			await frame();
		}
		expect(controller.pinned).toBe(true);
		await waitFor(() => fixture.distance() <= ARRIVED, { label: "catch-up closes the gap" });
	});

	it("touch drag back down to the bottom zone re-pins", async () => {
		const { fixture, controller } = setup();
		await touchDrag(fixture.container, { fromY: 100, toY: 200 });
		expect(controller.pinned).toBe(false);
		dragScrollbarTo(fixture.container, fixture.maxScrollTop() - 30);
		await frame();
		await touchDrag(fixture.container, { fromY: 200, toY: 150 });
		expect(controller.pinned).toBe(true);
	});

	it("re-attach glides the remaining gap closed instead of snapping", async () => {
		const { fixture, controller } = setup();
		wheel(fixture.container, -300);
		await frame();
		expect(controller.pinned).toBe(false);
		// Scroll back down to just inside the near-bottom zone: re-pins and
		// closes the last stretch with the spring — snaps are for content
		// growth, not for the user's own return to the bottom.
		dragScrollbarTo(fixture.container, fixture.maxScrollTop() - 50);
		await frames(2);
		expect(controller.pinned).toBe(true);
		expect(fixture.distance()).toBeGreaterThan(ARRIVED); // still gliding, no snap
		await waitFor(() => fixture.distance() <= ARRIVED, { label: "glide closes the gap" });
	});
});

describe("commands", () => {
	it("animateToBottom chases a moving target during streaming (never lands short)", async () => {
		const { fixture, controller } = setup();
		fixture.addBlock(2000);
		await waitFor(() => fixture.distance() <= ARRIVED, { label: "settle tall fixture" });
		wheel(fixture.container, -1500);
		await frame();
		expect(controller.pinned).toBe(false);
		controller.animateToBottom();
		// Content keeps growing while the animation runs.
		await stream(fixture, { pxPerFrame: 6, frameCount: 20 });
		await waitFor(() => fixture.distance() <= ARRIVED, { label: "arrives at LIVE bottom" });
		expect(controller.pinned).toBe(true);
	});

	it("long jumps teleport near the target first (bounded settle time)", async () => {
		const { fixture, controller } = setup();
		fixture.addBlock(8000);
		await waitFor(() => fixture.distance() <= ARRIVED, { label: "settle tall fixture" });
		dragScrollbarTo(fixture.container, 0);
		await frame();
		controller.animateToBottom();
		await waitFor(() => fixture.distance() <= ARRIVED, {
			maxFrames: 120,
			label: "8000px jump settles within 2s",
		});
	});

	it("animateTo moves without pinning", async () => {
		const { fixture, controller } = setup();
		fixture.addBlock(1000);
		await waitFor(() => fixture.distance() <= ARRIVED, { label: "settle" });
		controller.animateTo(100);
		await waitFor(() => Math.abs(fixture.scrollTop() - 100) <= 1, { label: "reaches target" });
		expect(controller.pinned).toBe(false);
		fixture.growLast(300);
		await frames(3);
		expect(Math.abs(fixture.scrollTop() - 100)).toBeLessThanOrEqual(1);
	});

	it("scrollTo is instant and does not pin", async () => {
		const { fixture, controller } = setup();
		controller.scrollTo(0);
		expect(fixture.scrollTop()).toBe(0);
		expect(controller.pinned).toBe(false);
	});

	it("reduced motion makes every move instant", async () => {
		const { fixture, controller } = setup({}, { reducedMotion: () => true });
		fixture.growLast(500);
		await frames(2); // ResizeObserver tick, synchronous write, no glide frames
		expect(fixture.distance()).toBeLessThanOrEqual(ARRIVED);
		dragScrollbarTo(fixture.container, 0);
		await frame();
		controller.animateToBottom();
		expect(fixture.distance()).toBeLessThanOrEqual(ARRIVED);
	});
});

describe("state reporting", () => {
	it("publishes nearBottom/scrolledUp transitions for the buttons, including growth while detached", async () => {
		const states: boolean[] = [];
		const { fixture, controller } = setup(
			{ blocks: [{ height: 300, user: true }, { height: 700 }] },
			{ onStateChange: (s) => states.push(s.nearBottom) }
		);
		wheel(fixture.container, -300);
		await frame();
		expect(controller.getState().nearBottom).toBe(false);
		expect(controller.getState().scrolledUp).toBe(true);
		// Growth while detached must refresh state without any scroll event
		// (the pre-controller buttons went stale exactly here).
		dragScrollbarTo(fixture.container, fixture.maxScrollTop() - 50);
		await frame();
		wheel(fixture.container, -10);
		await frame();
		const distanceBefore = controller.getState().distanceFromBottom;
		fixture.growLast(500);
		await frames(3);
		expect(controller.getState().distanceFromBottom).toBeGreaterThan(distanceBefore + 400);
	});
});

describe("lifecycle", () => {
	it("destroy() stops following, removes listeners, and never writes again", async () => {
		const { fixture, controller } = setup();
		controller.destroy();
		const top = fixture.scrollTop();
		fixture.growLast(500);
		wheel(fixture.container, -120);
		pressKey(fixture.container, "PageDown");
		await frames(4);
		// Only the harness's own emulated input moved it; no controller writes.
		expect(fixture.scrollTop()).toBeCloseTo(top - 120 + fixture.container.clientHeight * 0.9, 0);
	});
});

describe("no layout shift while following", () => {
	it("pinned streaming produces zero unexpected layout shift", async () => {
		const { fixture } = setup();
		await frames(3); // let initial content paint before probing
		const probe = startClsProbe();
		await stream(fixture, { pxPerFrame: 10, frameCount: 40 });
		await waitFor(() => fixture.distance() <= ARRIVED, { label: "settle" });
		await frames(3);
		expect(probe.score()).toBe(0);
		probe.stop();
	});
});

describe("fuzz: geometric invariants under random interleaving", () => {
	it("never unpins from programmatic motion, never pins without the user reaching bottom", async () => {
		const { fixture, controller } = setup({
			blocks: [{ height: 300, user: true }, { height: 900 }],
		});
		const random = mulberry32(0xc0ffee);
		let expectPinned = true;

		for (let i = 0; i < 80; i++) {
			await nextTask(); // simulate input from task context, like real input
			const op = random();
			if (op < 0.35) {
				fixture.growLast(Math.floor(random() * 80));
			} else if (op < 0.55) {
				wheel(fixture.container, -(20 + Math.floor(random() * 200)));
				expectPinned = false;
			} else if (op < 0.75) {
				wheel(fixture.container, 20 + Math.floor(random() * 200));
				await frame();
				if (fixture.distance() <= 60) expectPinned = true;
			} else {
				const target = Math.floor(random() * (fixture.maxScrollTop() + 1));
				const goingUp = target < fixture.scrollTop() - 1;
				const goingDown = target > fixture.scrollTop() + 1;
				dragScrollbarTo(fixture.container, target);
				await frame();
				if (goingUp) expectPinned = false;
				else if (goingDown && fixture.distance() <= 60) expectPinned = true;
			}
			await frame();
			if (expectPinned) {
				await waitFor(() => fixture.distance() <= ARRIVED, {
					label: `op ${i}: pinned view converges to bottom`,
				});
			}
			expect(controller.pinned, `after op ${i}`).toBe(expectPinned);
		}
	});
});
