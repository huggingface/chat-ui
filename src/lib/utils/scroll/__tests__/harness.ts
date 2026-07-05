/**
 * Browser UX harness for the scroll system.
 *
 * Builds a real scrollable DOM (no Svelte required), simulates streaming
 * growth on the same rAF cadence the app's token buffer uses, and simulates
 * user input three ways:
 *  - `wheel()` dispatches a real (untrusted) WheelEvent AND applies the scroll
 *    it would cause — untrusted events reach handlers but never perform the
 *    default scroll action, so the harness performs it;
 *  - `dragScrollbarTo()` sets scrollTop and lets the scroll event fire, which
 *    is byte-for-byte what a scrollbar drag, keyboard scroll or find-in-page
 *    jump produces (the whole point of position-based attribution);
 *  - `touchDrag()` dispatches TouchEvents with tracked identifiers plus the
 *    matching scroll movement.
 *
 * A PerformanceObserver-based CLS probe asserts zero unexpected layout shift.
 */

export interface FixtureOptions {
	viewportHeight?: number;
	/** Initial content blocks: heights in px, optionally tagged as user turns. */
	blocks?: { height: number; user?: boolean }[];
}

export interface Fixture {
	container: HTMLDivElement;
	/** The growing wrapper (the app's `messagesEl`). */
	content: HTMLDivElement;
	spacer: HTMLDivElement;
	addBlock(height: number, opts?: { user?: boolean; id?: string }): HTMLDivElement;
	lastBlock(): HTMLDivElement;
	growLast(px: number): void;
	setLastHeight(px: number): void;
	removeLast(): void;
	scrollTop(): number;
	maxScrollTop(): number;
	distance(): number;
	destroy(): void;
}

let blockCounter = 0;

export function createFixture(options: FixtureOptions = {}): Fixture {
	const viewportHeight = options.viewportHeight ?? 400;

	const container = document.createElement("div");
	container.style.cssText = `position: fixed; top: 0; left: 0; width: 320px; height: ${viewportHeight}px; overflow-y: auto;`;
	container.tabIndex = 0;

	// Mirrors ChatWindow's structure: a full-height column wrapping the
	// growing messages element plus the send-anchor spacer.
	const column = document.createElement("div");
	column.style.cssText = "display: flex; flex-direction: column; min-height: 100%;";

	const content = document.createElement("div");
	content.style.cssText = "display: flex; flex-direction: column;";

	const spacer = document.createElement("div");
	spacer.style.cssText = "flex-shrink: 0; height: 0px;";

	column.appendChild(content);
	column.appendChild(spacer);
	container.appendChild(column);
	document.body.appendChild(container);

	const fixture: Fixture = {
		container,
		content,
		spacer,
		addBlock(height, opts = {}) {
			const block = document.createElement("div");
			block.style.cssText = `height: ${height}px; flex-shrink: 0;`;
			block.dataset.messageId = opts.id ?? `m-${++blockCounter}`;
			if (opts.user) block.dataset.messageType = "user";
			// Painted content so layout-shift entries can be attributed.
			block.style.background = opts.user ? "#dbeafe" : "#f3f4f6";
			content.appendChild(block);
			return block;
		},
		lastBlock() {
			return content.lastElementChild as HTMLDivElement;
		},
		growLast(px) {
			const block = fixture.lastBlock();
			block.style.height = `${parseFloat(block.style.height) + px}px`;
		},
		setLastHeight(px) {
			fixture.lastBlock().style.height = `${px}px`;
		},
		removeLast() {
			fixture.lastBlock().remove();
		},
		scrollTop: () => container.scrollTop,
		maxScrollTop: () => Math.max(0, container.scrollHeight - container.clientHeight),
		distance: () => fixture.maxScrollTop() - container.scrollTop,
		destroy() {
			container.remove();
		},
	};

	for (const block of options.blocks ?? []) fixture.addBlock(block.height, { user: block.user });

	return fixture;
}

// --- timing -----------------------------------------------------------------------

export function frame(): Promise<void> {
	return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * Yield to a macrotask. Real user input is processed in tasks, which run
 * before a frame's scroll-event dispatch and rAF callbacks; test code that
 * has been awaiting frame() is inside an rAF microtask chain instead, where
 * a simulated scroll can interleave with the controller's animation writes
 * in an order no real input can produce. Await this before simulating input.
 */
export function nextTask(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function frames(n: number): Promise<void> {
	for (let i = 0; i < n; i++) await frame();
}

/** Await a condition across animation frames; throws with `label` on timeout. */
export async function waitFor(
	condition: () => boolean,
	{ maxFrames = 240, label = "condition" }: { maxFrames?: number; label?: string } = {}
): Promise<void> {
	for (let i = 0; i < maxFrames; i++) {
		if (condition()) return;
		await frame();
	}
	if (!condition()) throw new Error(`waitFor timed out after ${maxFrames} frames: ${label}`);
}

/** Grow the last block by `pxPerFrame` on each of `frameCount` animation
 * frames — the exact cadence of the app's rAF-flushed token buffer. */
export async function stream(
	fixture: Fixture,
	{ pxPerFrame, frameCount }: { pxPerFrame: number; frameCount: number },
	onFrame?: () => void
): Promise<void> {
	for (let i = 0; i < frameCount; i++) {
		fixture.growLast(pxPerFrame);
		await frame();
		onFrame?.();
	}
}

// --- input simulation --------------------------------------------------------------

export interface WheelOptions {
	target?: Element;
	deltaX?: number;
	ctrlKey?: boolean;
	/** Suppress the emulated default scroll (e.g. when an inner scroller would
	 * have consumed the event). */
	noScroll?: boolean;
}

export function wheel(container: HTMLElement, deltaY: number, opts: WheelOptions = {}) {
	const target = opts.target ?? container;
	target.dispatchEvent(
		new WheelEvent("wheel", {
			deltaY,
			deltaX: opts.deltaX ?? 0,
			ctrlKey: opts.ctrlKey ?? false,
			bubbles: true,
			cancelable: true,
		})
	);
	if (!opts.noScroll && !opts.ctrlKey) container.scrollTop += deltaY;
}

/** Exactly what a scrollbar drag produces: a scroll event at a new position,
 * with no wheel/touch/key event anywhere near it. */
export function dragScrollbarTo(container: HTMLElement, top: number) {
	container.scrollTop = top;
}

export function pressKey(container: HTMLElement, key: string) {
	container.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
	// Emulate the browser's default scroll for the common keys.
	if (key === "PageUp") container.scrollTop -= container.clientHeight * 0.9;
	if (key === "PageDown") container.scrollTop += container.clientHeight * 0.9;
	if (key === "Home") container.scrollTop = 0;
	if (key === "End") container.scrollTop = container.scrollHeight;
}

function touchEvent(
	type: string,
	target: Element,
	id: number,
	clientY: number,
	clientX = 50,
	extraTouches: Touch[] = []
): TouchEvent {
	const touch = new Touch({ identifier: id, target, clientX, clientY });
	const touches = type === "touchend" || type === "touchcancel" ? [] : [touch, ...extraTouches];
	return new TouchEvent(type, {
		touches,
		changedTouches: [touch],
		bubbles: true,
		cancelable: true,
	});
}

/** Drag a finger from `fromY` to `toY` in `steps`, applying the scroll each
 * step (finger down = content scrolls up). */
export async function touchDrag(
	container: HTMLElement,
	{
		fromY,
		toY,
		steps = 5,
		x = 50,
		target,
		noScroll = false,
	}: {
		fromY: number;
		toY: number;
		steps?: number;
		x?: number;
		target?: Element;
		noScroll?: boolean;
	}
) {
	const el = target ?? container;
	const id = Math.floor(Math.random() * 1e6);
	el.dispatchEvent(touchEvent("touchstart", el, id, fromY, x));
	for (let i = 1; i <= steps; i++) {
		const y = fromY + ((toY - fromY) * i) / steps;
		const prev = fromY + ((toY - fromY) * (i - 1)) / steps;
		el.dispatchEvent(touchEvent("touchmove", el, id, y, x));
		if (!noScroll) container.scrollTop -= y - prev;
		await frame();
	}
	el.dispatchEvent(touchEvent("touchend", el, id, toY, x));
}

/** A two-finger gesture (pinch-zoom): both fingers move, nothing scrolls. */
export async function pinch(container: HTMLElement, { spread = 80, steps = 4 } = {}) {
	const a = Math.floor(Math.random() * 1e6);
	const b = a + 1;
	const centerY = 200;
	const second = (offset: number) =>
		new Touch({ identifier: b, target: container, clientX: 60, clientY: centerY + offset });
	container.dispatchEvent(touchEvent("touchstart", container, a, centerY - 10, 50, [second(10)]));
	for (let i = 1; i <= steps; i++) {
		const offset = 10 + (spread * i) / steps;
		container.dispatchEvent(
			touchEvent("touchmove", container, a, centerY - offset, 50, [second(offset)])
		);
		await frame();
	}
	container.dispatchEvent(touchEvent("touchend", container, a, centerY - 10 - spread));
}

// --- layout shift probe ---------------------------------------------------------------

interface LayoutShiftEntry extends PerformanceEntry {
	value: number;
	hadRecentInput: boolean;
}

export interface ClsProbe {
	/** Cumulative score of shifts NOT caused by recent user input. */
	score(): number;
	stop(): void;
}

/**
 * Layout-shift entries are only emitted for content that has painted — callers
 * must wait ≥2 frames after building the fixture before starting the probe.
 */
export function startClsProbe(): ClsProbe {
	let score = 0;
	const observer = new PerformanceObserver((list) => {
		for (const entry of list.getEntries()) {
			const shift = entry as LayoutShiftEntry;
			if (!shift.hadRecentInput) score += shift.value;
		}
	});
	observer.observe({ type: "layout-shift", buffered: false });
	return {
		score() {
			// Flush pending records before reading.
			for (const entry of observer.takeRecords()) {
				const shift = entry as LayoutShiftEntry;
				if (!shift.hadRecentInput) score += shift.value;
			}
			return score;
		},
		stop() {
			observer.disconnect();
		},
	};
}

// --- deterministic RNG for fuzzing ------------------------------------------------------

export function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
