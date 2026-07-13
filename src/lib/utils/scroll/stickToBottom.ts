/**
 * Single-owner stick-to-bottom controller for a scrollable container.
 *
 * Replaces the previous stack of four uncoordinated systems (snapScrollToBottom
 * action, ChatWindow's spacer ResizeObserver autoscroll, and one listener set
 * per floating button) with one controller that owns exactly one scroll/wheel/
 * touch/keydown listener each, one ResizeObserver, and one rAF animation loop.
 *
 * Core mechanism — position-based scroll attribution instead of timers:
 * every programmatic write records the scrollTop it expects the next scroll
 * event to report. A scroll event that matches a pending write is ours; one
 * that matches a browser clamp after content shrank is neither ours nor the
 * user's; everything else is user input, by construction. This classifies
 * scrollbar drags, keyboard scrolling, find-in-page and selection auto-scroll
 * correctly without grace periods, and it cannot mistake the tail of a smooth
 * scroll for user input the way time-based heuristics do.
 */

export interface StickToBottomState {
	/** Auto-follow is engaged: content growth keeps the view glued to the bottom. */
	pinned: boolean;
	/** Within a couple px of the true bottom. */
	atBottom: boolean;
	/** Within `nearBottomPx` of the bottom — the re-attach zone. */
	nearBottom: boolean;
	/** Scrolled more than `scrolledUpPx` away from the top. */
	scrolledUp: boolean;
	distanceFromBottom: number;
}

export interface StickToBottomOptions {
	/**
	 * The element whose growth is being followed. Must be the element that
	 * actually resizes with content — observing a `height: 100%` wrapper is the
	 * bug that killed the previous implementation's autoscroll entirely.
	 */
	content?: () => HTMLElement | null | undefined;
	onStateChange?: (state: StickToBottomState) => void;
	/**
	 * Runs at the start of every content/container resize pass, before the
	 * controller re-pins — the hook where the chat spacer recomputes so the
	 * follow targets post-spacer geometry. `containerResized` is true when the
	 * container's own box changed (or on programmatic recompute()), letting
	 * callers skip container-box measurements on pure content growth.
	 */
	onContentResize?: (containerResized: boolean) => void;
	/** 'spring' glides toward the bottom; 'instant' hard-pins every growth. */
	followMode?: "spring" | "instant";
	nearBottomPx?: number;
	scrolledUpPx?: number;
	/**
	 * Touches starting within this many px of the left edge are ignored — for
	 * hosts where an edge-swipe gesture (e.g. a nav drawer) claims that strip
	 * and preventDefaults the touch, so it never scrolls anything.
	 */
	ignoreTouchZonePx?: number;
	/** Test seam; defaults to matchMedia('(prefers-reduced-motion: reduce)'). */
	reducedMotion?: () => boolean;
}

const AT_BOTTOM_EPS = 2;
/** Tolerance when matching a scroll event against a pending programmatic write
 * (fractional scrollTop under browser zoom / HiDPI rounding). */
const WRITE_MATCH_EPS = 1.5;
/** Cumulative upward user movement (px) required to unpin — filters sub-pixel
 * jitter without ignoring the smallest deliberate scroll. */
const UNPIN_DRIFT_PX = 3;
/** Upward finger travel (px) before a touch gesture counts as scroll intent. */
const TOUCH_INTENT_PX = 10;
/** Spring time constant: reach ~63% of remaining distance every 80ms. */
const SPRING_TAU_MS = 80;
/** Below this remaining distance the spring snaps to the target. */
const SPRING_SNAP_PX = 0.75;
/** Minimum spring speed so long tails converge instead of crawling. */
const SPRING_MIN_PX_PER_MS = 0.2;
/** Animated moves longer than this teleport most of the way first. */
const LONG_JUMP_PX = 2500;
const LONG_JUMP_LANDING_PX = 1200;

interface Animation {
	/** Live target — re-read every frame so streaming growth retargets the spring. */
	target: () => number;
	lastTime: number;
}

export class StickToBottomController {
	private container: HTMLElement;
	private opts: Required<
		Pick<StickToBottomOptions, "followMode" | "nearBottomPx" | "scrolledUpPx" | "ignoreTouchZonePx">
	> &
		StickToBottomOptions;

	private state: StickToBottomState = {
		pinned: true,
		atBottom: true,
		nearBottom: true,
		scrolledUp: false,
		distanceFromBottom: 0,
	};

	/** scrollTop values we wrote and whose scroll events haven't arrived yet. */
	private pendingWrites: number[] = [];
	private lastTop: number;
	private lastScrollHeight: number;
	private lastMax: number;
	private upwardDrift = 0;

	private anim: Animation | null = null;
	private rafId: number | null = null;

	private resizeObserver: ResizeObserver | null = null;
	private observedContent: HTMLElement | null = null;
	private touch: { id: number; y: number; target: EventTarget | null; intent: boolean } | null =
		null;
	private destroyed = false;

	constructor(container: HTMLElement, options: StickToBottomOptions = {}) {
		this.container = container;
		this.opts = {
			followMode: "spring",
			nearBottomPx: 60,
			scrolledUpPx: 200,
			ignoreTouchZonePx: 0,
			...options,
		};

		this.lastTop = this.clampedTop();
		this.lastScrollHeight = container.scrollHeight;
		this.lastMax = this.maxScrollTop();
		this.applyOverflowAnchor();

		container.addEventListener("scroll", this.onScroll, { passive: true });
		container.addEventListener("wheel", this.onWheel, { passive: true });
		container.addEventListener("touchstart", this.onTouchStart, { passive: true });
		container.addEventListener("touchmove", this.onTouchMove, { passive: true });
		container.addEventListener("touchend", this.onTouchEnd, { passive: true });
		container.addEventListener("touchcancel", this.onTouchEnd, { passive: true });
		container.addEventListener("keydown", this.onKeyDown);

		if (typeof ResizeObserver !== "undefined") {
			this.resizeObserver = new ResizeObserver(this.onResize);
			this.resizeObserver.observe(container);
			this.syncContentObserver();
		}

		this.recomputeState();
	}

	// --- geometry ---------------------------------------------------------------

	private maxScrollTop(): number {
		return Math.max(0, this.container.scrollHeight - this.container.clientHeight);
	}

	/** iOS rubber-banding reports scrollTop outside [0, max]; clamp before any
	 * direction comparison so a bottom-bounce is never read as user intent. */
	private clampedTop(): number {
		return Math.min(Math.max(this.container.scrollTop, 0), this.maxScrollTop());
	}

	private distanceFromBottom(): number {
		return this.maxScrollTop() - this.clampedTop();
	}

	private canScroll(): boolean {
		return this.container.scrollHeight > this.container.clientHeight + 1;
	}

	private prefersReducedMotion(): boolean {
		if (this.opts.reducedMotion) return this.opts.reducedMotion();
		return (
			typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
		);
	}

	/** Animated moves degrade to instant jumps for reduced-motion users and in
	 * hidden tabs (where rAF is throttled and a glide would replay on return). */
	private shouldSkipAnimation(): boolean {
		return this.prefersReducedMotion() || (typeof document !== "undefined" && document.hidden);
	}

	// --- state ------------------------------------------------------------------

	getState(): StickToBottomState {
		return { ...this.state };
	}

	get pinned(): boolean {
		return this.state.pinned;
	}

	private recomputeState(forceNotify = false, geometry?: { top: number; distance: number }) {
		const distance = geometry?.distance ?? this.distanceFromBottom();
		const top = geometry?.top ?? this.clampedTop();
		const next: StickToBottomState = {
			pinned: this.state.pinned,
			atBottom: distance <= AT_BOTTOM_EPS,
			nearBottom: distance <= this.opts.nearBottomPx,
			scrolledUp: top > this.opts.scrolledUpPx,
			distanceFromBottom: distance,
		};
		const changed =
			next.atBottom !== this.state.atBottom ||
			next.nearBottom !== this.state.nearBottom ||
			next.scrolledUp !== this.state.scrolledUp ||
			next.distanceFromBottom !== this.state.distanceFromBottom;
		this.state = next;
		if (changed || forceNotify) this.opts.onStateChange?.(this.getState());
	}

	private setPinned(pinned: boolean) {
		if (this.state.pinned === pinned) {
			this.recomputeState();
			return;
		}
		this.state = { ...this.state, pinned };
		this.applyOverflowAnchor();
		// recomputeState compares everything except pinned (which we just
		// changed), so force exactly one notification for the transition.
		this.recomputeState(true);
	}

	/**
	 * While pinned, native scroll anchoring only fights our own writes, so it's
	 * disabled. While the user reads scrolled-up, it's re-enabled so content
	 * growth above the viewport (late images, markdown swaps) doesn't shove the
	 * text under their eyes. Its adjustments are recognized in the scroll
	 * handler by their signature (scrollHeight and scrollTop change together,
	 * distance-from-bottom constant) so they are never mistaken for user input.
	 * No-op on Safari, which has no native anchoring at all — consistent either
	 * way.
	 */
	private applyOverflowAnchor() {
		this.container.style.overflowAnchor = this.state.pinned ? "none" : "auto";
	}

	// --- programmatic writes ------------------------------------------------------

	private write(top: number) {
		const max = this.maxScrollTop();
		const clamped = Math.min(Math.max(top, 0), max);
		// Same-position writes fire no scroll event; recording one would leave a
		// pending entry that never gets consumed and could later swallow a real
		// user scroll that happens to land on it.
		const before = this.container.scrollTop;
		if (Math.abs(before - clamped) < 0.5) return;
		this.container.scrollTop = clamped;
		// Read back: under fractional zoom a sub-pixel write can round to the
		// same device pixel (no event will fire), and iOS can drop writes during
		// active momentum. Only positions that actually applied are expected.
		const after = this.container.scrollTop;
		if (after === before) return;
		this.pendingWrites.push(after);
		if (this.pendingWrites.length > 4) this.pendingWrites.shift();
		// Update the last-known position NOW: if a user scroll lands in the same
		// frame, the browser coalesces both into one event at the user's final
		// position, and direction detection must compare against where we
		// actually put the view — not against a frame-old value.
		this.lastTop = Math.min(Math.max(after, 0), max);
		this.lastMax = max;
		this.lastScrollHeight = this.container.scrollHeight;
	}

	/** Match a scroll event's position against pending writes; consume on hit. */
	private consumeWrite(top: number): boolean {
		for (let i = 0; i < this.pendingWrites.length; i++) {
			if (Math.abs(this.pendingWrites[i] - top) <= WRITE_MATCH_EPS) {
				// Drop the matched write and everything older (their events were
				// coalesced away by the browser).
				this.pendingWrites.splice(0, i + 1);
				return true;
			}
		}
		return false;
	}

	// --- public commands ----------------------------------------------------------

	/** Instant to bottom + pinned. Conversation load/switch, coarse-pointer send. */
	jumpToBottom() {
		this.stopAnimation();
		this.setPinned(true);
		this.write(this.maxScrollTop());
		this.recomputeState();
	}

	/** Animated to bottom + pinned. Button click, fine-pointer send. */
	animateToBottom() {
		this.setPinned(true);
		if (this.shouldSkipAnimation()) {
			this.jumpToBottom();
			return;
		}
		const target = () => this.maxScrollTop();
		const remaining = target() - this.clampedTop();
		if (remaining > LONG_JUMP_PX) this.write(target() - LONG_JUMP_LANDING_PX);
		this.startAnimation(target);
	}

	pin(behavior: "instant" | "animate" = "instant") {
		if (behavior === "animate") this.animateToBottom();
		else this.jumpToBottom();
	}

	unpin() {
		this.stopAnimation();
		this.upwardDrift = 0;
		this.setPinned(false);
	}

	/** Animated move that does NOT engage following (e.g. scroll-to-previous). */
	animateTo(top: number) {
		this.unpin();
		if (this.shouldSkipAnimation()) {
			this.write(top);
			this.recomputeState();
			return;
		}
		const clamped = Math.min(Math.max(top, 0), this.maxScrollTop());
		this.startAnimation(() => clamped);
	}

	/** Instant move that does NOT engage following (deterministic view anchors,
	 * e.g. the artifact panel's per-view top/first-change positions). */
	scrollTo(top: number) {
		this.stopAnimation();
		this.setPinned(false);
		this.write(top);
		this.recomputeState();
	}

	/**
	 * Attribution-safe relative adjustment that changes neither pin state nor
	 * animation — for host-level scroll-anchoring compensation on engines
	 * without native `overflow-anchor` (Safari), where above-viewport content
	 * changes would otherwise shove a detached reader's text.
	 */
	adjustBy(delta: number) {
		if (this.destroyed || this.anim) return;
		this.write(this.clampedTop() + delta);
		this.recomputeState();
	}

	/** Re-read geometry and re-follow if pinned; safe to call any time. */
	recompute() {
		this.onResize();
	}

	destroy() {
		this.destroyed = true;
		this.stopAnimation();
		const c = this.container;
		c.style.overflowAnchor = "";
		c.removeEventListener("scroll", this.onScroll);
		c.removeEventListener("wheel", this.onWheel);
		c.removeEventListener("touchstart", this.onTouchStart);
		c.removeEventListener("touchmove", this.onTouchMove);
		c.removeEventListener("touchend", this.onTouchEnd);
		c.removeEventListener("touchcancel", this.onTouchEnd);
		c.removeEventListener("keydown", this.onKeyDown);
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
	}

	// --- animation ------------------------------------------------------------------

	private startAnimation(target: () => number) {
		this.anim = { target, lastTime: performance.now() };
		if (this.rafId === null) this.rafId = requestAnimationFrame(this.tick);
	}

	private stopAnimation() {
		this.anim = null;
		if (this.rafId !== null) {
			cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}
	}

	private tick = (time: number) => {
		this.rafId = null;
		if (this.destroyed || !this.anim) return;

		const dt = Math.min(Math.max(time - this.anim.lastTime, 1), 64);
		this.anim.lastTime = time;

		const target = this.anim.target();
		const top = this.clampedTop();
		const delta = target - top;

		if (Math.abs(delta) <= SPRING_SNAP_PX) {
			this.write(target);
			this.anim = null;
			this.recomputeState();
			return;
		}

		const springStep = delta * (1 - Math.exp(-dt / SPRING_TAU_MS));
		const minStep = Math.sign(delta) * Math.min(Math.abs(delta), SPRING_MIN_PX_PER_MS * dt);
		const step = Math.abs(springStep) > Math.abs(minStep) ? springStep : minStep;

		this.write(top + step);
		this.recomputeState();
		this.rafId = requestAnimationFrame(this.tick);
	};

	/**
	 * Pinned + content grew: glide (spring) or snap (instant/reduced-motion/
	 * hidden). `snap` forces the instant path for passes where the browser has
	 * ALREADY clamp-jumped scrollTop (content shrank / container grew while at
	 * the bottom): restoring the bottom in the same frame is invisible
	 * (pre-paint) and merges with the clamp into one scroll event that matches
	 * our write. A spring here would first paint the clamped position — a
	 * visible bounce — and when a host callback re-inflates scrollHeight in the
	 * same pass (the chat spacer), the clamp's scroll event loses its
	 * `max < lastMax` signature and would be misread as user input, unpinning
	 * mid-glide.
	 */
	private follow(snap = false) {
		if (!this.state.pinned) return;
		if (this.opts.followMode === "instant" || snap || this.shouldSkipAnimation()) {
			this.stopAnimation();
			this.write(this.maxScrollTop());
			return;
		}
		if (!this.anim) this.startAnimation(() => this.maxScrollTop());
	}

	// --- event handlers ---------------------------------------------------------------

	private onScroll = () => {
		// One geometry snapshot per event; every derived value below reuses it.
		const scrollHeight = this.container.scrollHeight;
		const max = Math.max(0, scrollHeight - this.container.clientHeight);
		const rawTop = this.container.scrollTop;
		const top = Math.min(Math.max(rawTop, 0), max);
		const distance = max - top;

		const ours = this.consumeWrite(rawTop);
		// Any delivered event supersedes older writes (per-element scroll events
		// are coalesced to the latest position each frame) — clearing here keeps
		// stale ≈bottom entries from swallowing a later real user scroll that
		// happens to land on the same position (e.g. a scrollbar drag to the
		// bottom, whose re-pin must NOT be skipped).
		this.pendingWrites.length = 0;
		// The browser clamped scrollTop because maxScrollTop shrank — content
		// got shorter (branch switch, collapsing reasoning block) or the
		// viewport got taller (window resize, panel close). Not user input.
		const clamped =
			!ours &&
			max < this.lastMax &&
			Math.abs(top - max) <= WRITE_MATCH_EPS &&
			this.lastTop > max + WRITE_MATCH_EPS;
		// Native scroll anchoring (enabled while unpinned) compensating for
		// content growth above the viewport: scrollTop and scrollHeight move
		// together, distance from the bottom stays put. Not user input either.
		const anchorAdjust =
			!ours &&
			!clamped &&
			scrollHeight !== this.lastScrollHeight &&
			Math.abs(distance - (this.lastMax - this.lastTop)) <= AT_BOTTOM_EPS;

		if (clamped && !this.state.pinned) {
			// A clamp by definition lands the view at the (new) exact bottom;
			// there is nothing below to read, so following is the only sensible
			// continuation (the old sentinel behaved the same way). Without this,
			// a reasoning-collapse or keyboard-close clamp would leave a detached
			// user sitting at the bottom while the stream runs below the fold.
			this.setPinned(true);
		} else if (!ours && !clamped && !anchorAdjust) {
			// User input, by construction.
			if (top < this.lastTop) {
				this.upwardDrift += this.lastTop - top;
				if (this.upwardDrift >= UNPIN_DRIFT_PX && this.state.pinned) {
					this.unpin();
				}
			} else {
				this.upwardDrift = 0;
				if (top > this.lastTop && distance <= this.opts.nearBottomPx && !this.state.pinned) {
					// User came back to the bottom zone: re-engage and glide the
					// remaining gap closed (spring, so no re-attach snap).
					this.setPinned(true);
					this.follow();
				}
			}
		}

		this.lastTop = top;
		this.lastScrollHeight = scrollHeight;
		this.lastMax = max;
		this.recomputeState(false, { top, distance });
	};

	private onResize = (entries?: ResizeObserverEntry[]) => {
		if (this.destroyed) return;
		// The gutter (and other container-box-dependent measurements) can only
		// change when the container itself resized, not on every content frame.
		const containerResized = !entries || entries.some((e) => e.target === this.container);
		// Clamp signature, sampled BEFORE the host callback mutates layout (a
		// spacer re-inflation can immediately restore maxScrollTop and hide it):
		// scrollTop sits exactly at max after moving UP without a write of ours.
		// Only this signature may force an instant re-pin — a mere resize must
		// not, because a user scroll can be pending in the same pass (delivery
		// order is not guaranteed) and an eager write would overwrite the
		// user's position and then swallow their coalesced scroll event as ours.
		const preTop = this.container.scrollTop;
		const clampJumped =
			Math.abs(preTop - this.maxScrollTop()) <= WRITE_MATCH_EPS &&
			preTop < this.lastTop - WRITE_MATCH_EPS;
		this.syncContentObserver();
		this.opts.onContentResize?.(containerResized);
		this.follow(clampJumped);
		// Deliberately do NOT refresh the attribution baselines (lastTop &co)
		// here: a scroll event can still be in flight for a position change
		// that happened before this resize (ResizeObserver delivery can precede
		// the scroll steps when the change originated inside a rAF callback),
		// and classifying that event needs the pre-change baseline. Baselines
		// move only in write() and onScroll — the clamp rule (max < lastMax)
		// then recognizes shrink/viewport-growth clamps on its own.
		this.recomputeState();
	};

	/** (Re-)observe the growing content element; it can be replaced across renders. */
	private syncContentObserver() {
		if (!this.resizeObserver) return;
		const content = this.opts.content?.() ?? (this.container.firstElementChild as HTMLElement);
		if (content === this.observedContent) return;
		if (this.observedContent) this.resizeObserver.unobserve(this.observedContent);
		this.observedContent = content ?? null;
		if (content) this.resizeObserver.observe(content);
	}

	/**
	 * True when a scrollable element between `target` and the container will
	 * consume this wheel/touch delta itself (e.g. wheel-up inside a code block
	 * that can still scroll up) — in that case the gesture says nothing about
	 * the chat container and must not change pin state.
	 */
	private innerScrollableConsumes(target: EventTarget | null, deltaY: number): boolean {
		let el = target instanceof Element ? target : null;
		while (el && el !== this.container) {
			if (el instanceof HTMLElement && el.scrollHeight > el.clientHeight + 1) {
				const hasRoom =
					deltaY < 0 ? el.scrollTop > 0 : el.scrollTop < el.scrollHeight - el.clientHeight - 1;
				if (hasRoom) {
					// Only a real scroller consumes wheel/touch deltas — an
					// overflow:hidden element can carry residual scrollTop but the
					// browser won't scroll it, so the gesture reaches the container.
					const overflowY = getComputedStyle(el).overflowY;
					if (overflowY === "auto" || overflowY === "scroll") return true;
				}
			}
			el = el.parentElement;
		}
		return false;
	}

	private normalizeWheelDelta(event: WheelEvent): number {
		if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 16;
		if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE)
			return event.deltaY * this.container.clientHeight;
		return event.deltaY;
	}

	private onWheel = (event: WheelEvent) => {
		// ctrl+wheel is pinch-zoom, not scrolling.
		if (event.ctrlKey) return;
		// Dominantly horizontal trackpad pans (e.g. over a wide code block)
		// carry small vertical jitter that must not read as scroll intent.
		if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
		const deltaY = this.normalizeWheelDelta(event);
		if (deltaY === 0) return;

		// Cheap state checks come first: wheel events arrive at trackpad rates
		// during streaming (when layout is dirty every frame), and the ancestor
		// walk below forces a reflow — skip it whenever nothing could change.
		if (deltaY < 0) {
			if (!this.state.pinned && !this.anim) return;
			if (!this.canScroll()) return;
			if (this.innerScrollableConsumes(event.target, deltaY)) return;
			// Fast path so a running follow animation halts the same frame the
			// user pushes back, instead of waiting for the scroll event.
			this.unpin();
		} else {
			if (this.state.pinned || !this.canScroll()) return;
			if (this.distanceFromBottom() > this.opts.nearBottomPx) return;
			if (this.innerScrollableConsumes(event.target, deltaY)) return;
			this.setPinned(true);
			this.follow();
		}
	};

	private onTouchStart = (event: TouchEvent) => {
		// A second finger means pinch-zoom, not scrolling — drop the gesture
		// entirely (its fingers spreading must not read as scroll intent).
		if (event.touches.length > 1) {
			this.touch = null;
			return;
		}
		const t = event.touches[0];
		if (!t) return;
		if (t.clientX < this.opts.ignoreTouchZonePx) return;
		this.touch = { id: t.identifier, y: t.clientY, target: event.target, intent: false };
	};

	private onTouchMove = (event: TouchEvent) => {
		if (event.touches.length > 1) {
			this.touch = null;
			return;
		}
		if (!this.touch || !this.canScroll()) return;
		let t: Touch | undefined;
		for (let i = 0; i < event.touches.length; i++) {
			if (event.touches[i].identifier === this.touch.id) t = event.touches[i];
		}
		if (!t) return;

		const travel = t.clientY - this.touch.y; // finger down = view up
		if (!this.touch.intent && Math.abs(travel) < TOUCH_INTENT_PX) return;
		this.touch.intent = true;

		if (travel > 0) {
			if (!this.innerScrollableConsumes(this.touch.target, -1)) this.unpin();
		} else if (
			travel < 0 &&
			!this.state.pinned &&
			this.distanceFromBottom() <= this.opts.nearBottomPx &&
			!this.innerScrollableConsumes(this.touch.target, 1)
		) {
			this.setPinned(true);
			this.follow();
		}
		this.touch.y = t.clientY;
	};

	private onTouchEnd = (event: TouchEvent) => {
		if (!this.touch) return;
		for (let i = 0; i < event.touches.length; i++) {
			if (event.touches[i].identifier === this.touch.id) return;
		}
		this.touch = null;
	};

	private onKeyDown = (event: KeyboardEvent) => {
		// A widget that consumed the key (dropdown menu, select) will not
		// scroll the container — no intent to read.
		if (event.defaultPrevented) return;
		const target = event.target;
		if (
			target instanceof HTMLElement &&
			(target.tagName === "INPUT" ||
				target.tagName === "TEXTAREA" ||
				target.tagName === "SELECT" ||
				target.isContentEditable)
		) {
			return;
		}
		if (event.key === "PageUp" || event.key === "Home" || event.key === "ArrowUp") {
			if (this.canScroll()) this.unpin();
		}
		// Downward keys (PageDown/End/ArrowDown/Space) re-pin through the scroll
		// handler's nearBottom rule once the native scroll lands there.
	};
}
