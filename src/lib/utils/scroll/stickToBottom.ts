/**
 * Geometric stick-to-bottom controller for a scrollable container.
 *
 * The pin state is decided by where scroll positions land, not by which device
 * produced them (in the spirit of Streamdown's pinned scroll): upward movement
 * detaches, downward movement into the near-bottom zone re-attaches, and a
 * clamp to the bottom after content shrank re-attaches because there is
 * nothing below left to read. This works without any bookkeeping of expected
 * positions because every programmatic move either lands exactly at the bottom
 * (follows) or begins by explicitly unpinning (jumps to a reading position) —
 * so programmatic scroll events can never *look like* user intent, and the
 * previous implementation's write-attribution queue, follow-mode duality,
 * wheel/touch intent tracking, keyboard handler, and inner-scrollable walks
 * are all unnecessary. See docs/scroll/foundations/scroll-model.md.
 *
 * While pinned, growth is answered with a next-frame snap; easing exists only
 * for explicit moves (send, the jump buttons, re-attach catch-up), as a
 * live-target spring that any upward wheel or touch cancels instantly.
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
	 * bug that killed an earlier implementation's autoscroll entirely.
	 */
	content?: () => HTMLElement | null | undefined;
	onStateChange?: (state: StickToBottomState) => void;
	/**
	 * Runs at the start of every content/container resize pass, before the
	 * controller re-follows. `containerResized` is true when the container's
	 * own box changed (or on programmatic recompute()), letting callers skip
	 * container-box measurements on pure content growth.
	 */
	onContentResize?: (containerResized: boolean) => void;
	nearBottomPx?: number;
	scrolledUpPx?: number;
	/** Test seam; defaults to matchMedia('(prefers-reduced-motion: reduce)'). */
	reducedMotion?: () => boolean;
}

const AT_BOTTOM_EPS = 2;
/** Cumulative upward user movement (px) required to unpin — filters sub-pixel
 * jitter without ignoring the smallest deliberate scroll. */
const UNPIN_DRIFT_PX = 3;
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
	/** Write the full remaining distance on the first tick instead of springing.
	 * Growth follows go through a tick (not a synchronous write) so a
	 * same-frame user scroll — whose scroll event dispatches before rAF
	 * callbacks — is classified first and its unpin cancels the write. */
	snap?: boolean;
}

export class StickToBottomController {
	private container: HTMLElement;
	private opts: Required<Pick<StickToBottomOptions, "nearBottomPx" | "scrolledUpPx">> &
		StickToBottomOptions;

	private state: StickToBottomState = {
		pinned: true,
		atBottom: true,
		nearBottom: true,
		scrolledUp: false,
		distanceFromBottom: 0,
	};

	/** Attribution baselines: the last classified position and geometry. Moved
	 * only in write() and onScroll, never in onResize — a scroll event can
	 * still be in flight for a position change that predates a resize, and
	 * classifying it (the clamp rule especially) needs the older baseline. */
	private lastTop: number;
	private lastScrollHeight: number;
	private lastMax: number;
	private upwardDrift = 0;

	private anim: Animation | null = null;
	private rafId: number | null = null;

	private resizeObserver: ResizeObserver | null = null;
	private observedContent: HTMLElement | null = null;
	private lastTouchY: number | null = null;
	private destroyed = false;

	constructor(container: HTMLElement, options: StickToBottomOptions = {}) {
		this.container = container;
		this.opts = {
			nearBottomPx: 60,
			scrolledUpPx: 200,
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
		const distance = geometry?.distance ?? this.maxScrollTop() - this.clampedTop();
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
	 * distance-from-bottom constant) so they are never read as user intent.
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
		const before = this.container.scrollTop;
		if (Math.abs(before - clamped) < 0.5) return;
		this.container.scrollTop = clamped;
		// Move the baselines NOW: the scroll event for this write must read as
		// zero movement, and if a user scroll lands in the same frame the
		// browser coalesces both into one event at the user's final position —
		// whose delta against the post-write baseline is exactly the user's own
		// movement. This is the entire residue of write attribution.
		this.lastTop = Math.min(Math.max(this.container.scrollTop, 0), max);
		this.lastMax = max;
		this.lastScrollHeight = this.container.scrollHeight;
	}

	// --- public commands ----------------------------------------------------------

	/** Instant to bottom + pinned. Conversation load/switch, coarse-pointer send. */
	jumpToBottom() {
		this.stopAnimation();
		this.setPinned(true);
		this.write(this.maxScrollTop());
		this.recomputeState();
	}

	/** Animated to bottom + pinned, chasing the live bottom. Button click,
	 * fine-pointer send/anchor. */
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
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
	}

	// --- animation ------------------------------------------------------------------

	private startAnimation(target: () => number, opts?: { snap?: boolean }) {
		this.anim = { target, lastTime: performance.now(), snap: opts?.snap };
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

		if (this.anim.snap || Math.abs(delta) <= SPRING_SNAP_PX) {
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
	 * Pinned + the view must catch up to the bottom. Growth snaps on the next
	 * tick; a user re-attaching glides the remaining gap closed so coming back
	 * never feels like a teleport. A live-target glide already in flight (send,
	 * jump button) is left alone — it lands at the new bottom by itself.
	 */
	private follow(reason: "growth" | "reattach" = "growth") {
		if (!this.state.pinned) return;
		if (this.shouldSkipAnimation()) {
			// Hidden tabs must not wait on a throttled rAF; reduced-motion keeps
			// its long-standing synchronous write.
			this.stopAnimation();
			this.write(this.maxScrollTop());
			return;
		}
		if (this.anim) return;
		if (reason === "growth") {
			// One tick of deferral, not a synchronous write: this runs inside a
			// ResizeObserver callback, and a user scroll from the same frame may
			// not have dispatched its scroll event yet. Scroll events run before
			// rAF callbacks, so the user's unpin cancels the pending snap instead
			// of being overwritten by it.
			this.startAnimation(() => this.maxScrollTop(), { snap: true });
		} else {
			this.startAnimation(() => this.maxScrollTop());
		}
	}

	// --- event handlers ---------------------------------------------------------------

	private onScroll = () => {
		// One geometry snapshot per event; every derived value below reuses it.
		const scrollHeight = this.container.scrollHeight;
		const max = Math.max(0, scrollHeight - this.container.clientHeight);
		const top = Math.min(Math.max(this.container.scrollTop, 0), max);
		const distance = max - top;

		// The browser clamped a parked view to the (new) exact bottom because
		// content got shorter (branch switch, collapsing reasoning block) or the
		// viewport got taller (window resize, keyboard close). There is nothing
		// below left to read, so following is the only sensible continuation.
		const clamped =
			distance <= AT_BOTTOM_EPS &&
			max < this.lastMax - AT_BOTTOM_EPS &&
			this.lastTop > max + AT_BOTTOM_EPS;
		// Native scroll anchoring (enabled while unpinned) compensating for
		// content growth above the viewport: scrollTop and scrollHeight move
		// together, distance from the bottom stays put. Not user input either.
		const anchorAdjust =
			!clamped &&
			scrollHeight !== this.lastScrollHeight &&
			Math.abs(distance - (this.lastMax - this.lastTop)) <= AT_BOTTOM_EPS;

		if (clamped) {
			this.upwardDrift = 0;
			if (!this.state.pinned) this.setPinned(true);
		} else if (!anchorAdjust) {
			if (top < this.lastTop) {
				// Upward movement. Our own writes moved the baselines already, so
				// a delta here is the user's (or a coalesced event's user share).
				this.upwardDrift += this.lastTop - top;
				if (this.upwardDrift >= UNPIN_DRIFT_PX && (this.state.pinned || this.anim)) {
					this.unpin();
				}
			} else if (top > this.lastTop) {
				this.upwardDrift = 0;
				if (!this.state.pinned && distance <= this.opts.nearBottomPx) {
					// User came back to the bottom zone: re-engage and glide the
					// remaining gap closed.
					this.setPinned(true);
					this.follow("reattach");
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
		this.syncContentObserver();
		this.opts.onContentResize?.(containerResized);
		this.follow();
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

	private normalizeWheelDelta(event: WheelEvent): number {
		if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 16;
		if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE)
			return event.deltaY * this.container.clientHeight;
		return event.deltaY;
	}

	/**
	 * Input handlers exist ONLY to interrupt an in-flight glide: a spring
	 * moving toward the bottom can outpace the user's upward scroll within a
	 * frame, so the coalesced scroll event would read as downward and the
	 * geometric rules alone would let the glide win the fight. With no glide
	 * running (all of streaming — growth follows are snaps, not glides), these
	 * handlers do nothing and the scroll events decide everything, which is
	 * what makes wheel-in-a-code-block, pinch-zoom, horizontal pans and
	 * edge-swipe gestures need no special handling: they move nothing, so they
	 * change nothing.
	 */
	private onWheel = (event: WheelEvent) => {
		if (!this.anim || this.anim.snap) return;
		if (event.ctrlKey) return; // pinch-zoom
		if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return; // horizontal pan
		if (this.normalizeWheelDelta(event) < 0) this.unpin();
	};

	private onTouchStart = (event: TouchEvent) => {
		this.lastTouchY = event.touches.length === 1 ? event.touches[0].clientY : null;
	};

	private onTouchMove = (event: TouchEvent) => {
		if (event.touches.length !== 1) {
			this.lastTouchY = null;
			return;
		}
		const y = event.touches[0].clientY;
		const lastY = this.lastTouchY;
		this.lastTouchY = y;
		// An active finger dragging AWAY from the bottom (finger down = content
		// up) during a glide takes the view. Drags toward the bottom leave the
		// glide running — it is already going where they want, and the geometric
		// re-attach rule covers them if it gets canceled elsewhere. Momentum
		// after the finger lifts sends no touchmove, but its scroll events carry
		// direction and the geometric rules handle them.
		if (this.anim && !this.anim.snap && lastY !== null && y > lastY + 1) this.unpin();
	};

	private onTouchEnd = () => {
		this.lastTouchY = null;
	};
}
