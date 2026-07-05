import { afterEach, describe, expect, it } from "vitest";
import { StickToBottomController, type StickToBottomOptions } from "../stickToBottom";
import {
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

	it("follows a single large growth back to the bottom (spring)", async () => {
		const { fixture, controller } = setup();
		fixture.growLast(500);
		await waitFor(() => fixture.distance() <= ARRIVED, { label: "spring reaches bottom" });
		expect(controller.pinned).toBe(true);
	});

	it("stays glued through continuous rAF-cadence streaming", async () => {
		const { fixture } = setup();
		let maxLag = 0;
		await stream(fixture, { pxPerFrame: 8, frameCount: 60 }, () => {
			maxLag = Math.max(maxLag, fixture.distance());
		});
		await waitFor(() => fixture.distance() <= ARRIVED, { label: "settles after stream" });
		// Spring lag stays bounded well within the spacer's 208px floor.
		expect(maxLag).toBeLessThan(200);
	});

	it("instant follow mode pins hard on every growth", async () => {
		const { fixture } = setup({}, { followMode: "instant" });
		fixture.growLast(700);
		await frames(2); // ResizeObserver delivery
		expect(fixture.distance()).toBeLessThanOrEqual(ARRIVED);
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

	it("wheel up halts a running follow animation immediately", async () => {
		const { fixture, controller } = setup();
		fixture.growLast(1200);
		await frames(3); // spring in flight
		const before = fixture.scrollTop();
		wheel(fixture.container, -120);
		await frames(3);
		expect(controller.pinned).toBe(false);
		// Only our emulated wheel default moved the view — no further catch-up.
		expect(fixture.scrollTop()).toBeLessThanOrEqual(before - 120 + 1);
	});

	it("scrollbar drag up unpins (no wheel/touch involved)", async () => {
		const { fixture, controller } = setup();
		dragScrollbarTo(fixture.container, fixture.scrollTop() - 200);
		await frame();
		expect(controller.pinned).toBe(false);
	});

	it("PageUp unpins via the keyboard fast path", async () => {
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

	it("touches starting in a configured edge-swipe zone are ignored", async () => {
		const { fixture, controller } = setup({}, { ignoreTouchZonePx: 40 });
		await touchDrag(fixture.container, { fromY: 100, toY: 260, x: 30, noScroll: true });
		expect(controller.pinned).toBe(true);
		// Outside the zone the same gesture detaches.
		await touchDrag(fixture.container, { fromY: 100, toY: 260, x: 60 });
		expect(controller.pinned).toBe(false);
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

	it("wheel up over an inner scrollable that can consume it does not unpin", async () => {
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
		wheel(fixture.container, -120, { target: inner, noScroll: true });
		await frame();
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

	it("shrink that clamps the view to the bottom resumes following (sentinel parity)", async () => {
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
		await frames(2); // ResizeObserver tick, no spring frames
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
		// (the old buttons went stale exactly here).
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

describe("fuzz: attribution invariants under random interleaving", () => {
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
