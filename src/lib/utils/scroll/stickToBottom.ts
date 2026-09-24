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
 * are all unnecessary. The one thing geometry cannot tell apart is the
 * browser moving the view on its own (Safari does, mid-DOM-swap): input
 * listeners therefore stamp gestures, and an upward move with no gesture
 * behind it is undone rather than obeyed.
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
	/** An animated move (send, jump buttons, re-attach catch-up) is in
	 * flight — the view is on its way somewhere, not parked. */
	gliding: boolean;
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
	/**
	 * Touches starting within this many px of the left edge are ignored — for
	 * hosts where an edge-swipe gesture (e.g. a nav drawer) claims that strip
	 * and prevents the touch from scrolling anything, so it must not cancel a
	 * glide either.
	 */
	ignoreTouchZonePx?: number;
	/** Test seam; defaults to matchMedia('(prefers-reduced-motion: reduce)'). */
	reducedMotion?: () => boolean;
}

const AT_BOTTOM_EPS = 2;
/** Cumulative upward user movement (px) required to unpin — filters sub-pixel
 * jitter without ignoring the smallest deliberate scroll. */
const UNPIN_DRIFT_PX = 3;
/**
 * How long after a user gesture (wheel, touch, scrollbar mousedown, key) an
 * upward scroll event still counts as the user's. Each user-attributed event
 * extends the window, so a touch flick's momentum — a stream of events with
 * no touch events behind it — stays attributed for its whole run, while an
 * isolated event the browser produced on its own does not. Safari clamps a
 * scroller's position synchronously while DOM nodes are being swapped
 * (streaming markdown, keyed re-renders, hydration) and then reports the
 * clamp as a scroll event; with no gesture behind it, that is not a detach.
 */
const GESTURE_CHAIN_MS = 150;
/**
 * How long after a content change (a DOM mutation or a resize of the followed
 * content) an upward, gesture-less scroll event while following still counts
 * as the browser's own clamp rather than navigation. Safari's clamps arrive
 * in the rendering update right after the mutation that caused them; a
 * find-in-page jump or an assistive-technology scroll changes nothing in the
 * DOM first, so with a quiet DOM the move is the reader's and detaches.
 */
const CONTENT_ACTIVITY_MS = 120;
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
	private opts: Required<
		Pick<StickToBottomOptions, "nearBottomPx" | "scrolledUpPx" | "ignoreTouchZonePx">
	> &
		StickToBottomOptions;

	private state: StickToBottomState = {
		pinned: true,
		atBottom: true,
		nearBottom: true,
		scrolledUp: false,
		gliding: false,
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
	private mutationObserver: MutationObserver | null = null;
	private observedContent: HTMLElement | null = null;
	/** Content activity stamps (see CONTENT_ACTIVITY_MS). */
	private lastMutationAt = Number.NEGATIVE_INFINITY;
	private lastResizeAt = Number.NEGATIVE_INFINITY;
	private lastTouchY: number | null = null;
	private lastTouchX: number | null = null;
	/** Where the current touch started; a touch is a gesture once it has moved. */
	private touchStart: { x: number; y: number } | null = null;
	/** Gesture attribution (see GESTURE_CHAIN_MS), by the direction the input
	 * could have moved the conversation: an upward scroll event is the user's
	 * only when an upward-capable gesture is behind it. */
	private lastUpGestureAt = Number.NEGATIVE_INFINITY;
	private lastDownGestureAt = Number.NEGATIVE_INFINITY;
	/** Single-jump inputs only (scrollbar mousedown, keys) — see anchorAdjust. */
	private lastJumpGestureAt = Number.NEGATIVE_INFINITY;
	private pointerHeld = false;
	/** A press on content that has not moved yet — a click or the start of a
	 * text selection, which is not scroll intent until it drags. */
	private pressStart: { x: number; y: number } | null = null;
	private touchHeld = false;
	/** Where a held, vertically dragging finger is pushing the conversation —
	 * only while the conversation can follow it (not at the edge it pushes
	 * toward, not inside a nested scroller that takes the drag). */
	private touchDirection: "up" | "down" | null = null;
	private destroyed = false;

	constructor(container: HTMLElement, options: StickToBottomOptions = {}) {
		this.container = container;
		this.opts = {
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
		container.addEventListener("keydown", this.onKeyDown, { passive: true });
		container.addEventListener("mousedown", this.onMouseDown, { passive: true });
		container.addEventListener("mousemove", this.onMouseMove, { passive: true });
		if (typeof window !== "undefined") {
			window.addEventListener("mouseup", this.onWindowMouseUp, { passive: true });
		}

		if (typeof MutationObserver !== "undefined") {
			this.mutationObserver = new MutationObserver(() => {
				this.lastMutationAt = performance.now();
			});
		}
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
			gliding: this.anim !== null && !this.anim.snap,
			distanceFromBottom: distance,
		};
		const changed =
			next.atBottom !== this.state.atBottom ||
			next.nearBottom !== this.state.nearBottom ||
			next.scrolledUp !== this.state.scrolledUp ||
			next.gliding !== this.state.gliding ||
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

	/** Explicit park moves adopt the current geometry as the attribution
	 * baseline: a clamp the browser applied just before (a regenerate's
	 * collapse landing in read mode) has its scroll event still in flight, and
	 * measured against the pre-clamp baseline it would read as "clamped to the
	 * bottom, re-attach" — undoing the park. The view is where it was asked to
	 * be; nothing before that is user intent or a clamp to honor. */
	private adoptBaselines() {
		this.lastTop = this.clampedTop();
		this.lastMax = this.maxScrollTop();
		this.lastScrollHeight = this.container.scrollHeight;
		this.upwardDrift = 0;
	}

	/**
	 * Animated move that does NOT engage following (scroll-to-previous, the
	 * read-mode landing of a send). A function target is re-read every frame,
	 * so a landing computed from element geometry stays correct while late
	 * content (a placeholder unmounting, the composer settling) still shifts
	 * that geometry; either way the target is clamped to what is reachable
	 * each tick, so the glide always terminates instead of chasing a position
	 * the page cannot scroll to.
	 */
	animateTo(top: number | (() => number)) {
		this.unpin();
		this.adoptBaselines();
		const resolve = typeof top === "function" ? top : () => top;
		if (this.shouldSkipAnimation()) {
			this.write(resolve());
			this.recomputeState();
			return;
		}
		this.startAnimation(() => Math.min(Math.max(resolve(), 0), this.maxScrollTop()));
	}

	/** Instant move that does NOT engage following (deterministic view anchors,
	 * e.g. the artifact panel's per-view top/first-change positions). */
	scrollTo(top: number) {
		this.stopAnimation();
		this.setPinned(false);
		this.adoptBaselines();
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
		c.removeEventListener("keydown", this.onKeyDown);
		c.removeEventListener("mousedown", this.onMouseDown);
		c.removeEventListener("mousemove", this.onMouseMove);
		if (typeof window !== "undefined") {
			window.removeEventListener("mouseup", this.onWindowMouseUp);
		}
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		this.mutationObserver?.disconnect();
		this.mutationObserver = null;
	}

	// --- animation ------------------------------------------------------------------

	private startAnimation(target: () => number, opts?: { snap?: boolean }) {
		this.anim = { target, lastTime: performance.now(), snap: opts?.snap };
		if (this.rafId === null) this.rafId = requestAnimationFrame(this.tick);
		this.recomputeState();
	}

	private stopAnimation() {
		const had = this.anim !== null;
		this.anim = null;
		if (this.rafId !== null) {
			cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}
		if (had) this.recomputeState();
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
		// together, distance from the bottom stays put. Not user input either —
		// unless a single-jump input (a scrollbar drag, End/PageDown) is behind
		// it: a reader parked at the anchor (distance 0) who drags to the new
		// bottom after growth (distance 0) leaves the same geometric trace, and
		// that IS the user. Wheel and touch move in chains of events whose
		// distances change, so they never match this signature themselves, and
		// an adjustment landing right after one is still the browser's.
		const anchorAdjust =
			!clamped &&
			!this.jumpGestured() &&
			scrollHeight !== this.lastScrollHeight &&
			Math.abs(distance - (this.lastMax - this.lastTop)) <= AT_BOTTOM_EPS;

		if (clamped) {
			this.upwardDrift = 0;
			if (!this.state.pinned) this.setPinned(true);
		} else if (!anchorAdjust) {
			if (top < this.lastTop) {
				// Upward movement. Our own writes moved the baselines already, so
				// a delta here is either the user's (or a coalesced event's user
				// share) — or the browser's own doing, which only the absence of
				// any gesture can reveal.
				if (!this.gesturedUp() && this.state.pinned && this.contentActive()) {
					// Browser-initiated (Safari clamping mid-DOM-swap — the DOM just
					// changed): undo it in the same event, before paint, so nothing
					// flickers. A glide in flight is cut short and lands at the bottom
					// right away: on a fast stream the per-token clamps arrive faster
					// than a spring can win them back, and the user asked for the
					// bottom.
					this.stopAnimation();
					this.write(this.maxScrollTop());
					this.recomputeState();
					return;
				} else if (this.gesturedUp() || this.state.pinned) {
					// The user's own movement — or, with a quiet DOM, the browser
					// navigating on the reader's behalf (find-in-page, assistive
					// technology), which is theirs to keep just the same.
					if (this.gesturedUp()) this.lastUpGestureAt = performance.now();
					this.upwardDrift += this.lastTop - top;
					if (this.upwardDrift >= UNPIN_DRIFT_PX && (this.state.pinned || this.anim)) {
						this.unpin();
					}
				}
			} else if (top > this.lastTop) {
				if (this.gesturedDown()) this.lastDownGestureAt = performance.now();
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
		this.lastResizeAt = performance.now();
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
		this.mutationObserver?.disconnect();
		if (content) {
			this.mutationObserver?.observe(content, {
				childList: true,
				subtree: true,
				attributes: true,
				characterData: true,
			});
		}
	}

	/** The followed content changed within CONTENT_ACTIVITY_MS. */
	private contentActive(): boolean {
		const now = performance.now();
		return (
			now - this.lastMutationAt <= CONTENT_ACTIVITY_MS ||
			now - this.lastResizeAt <= CONTENT_ACTIVITY_MS
		);
	}

	// --- gesture attribution --------------------------------------------------------

	private noteGesture(direction: "up" | "down" | "both") {
		const now = performance.now();
		if (direction !== "down") this.lastUpGestureAt = now;
		if (direction !== "up") this.lastDownGestureAt = now;
	}

	/** True while the user is plausibly the author of upward movement: a
	 * scrollbar or dragging pointer held, a finger dragging the conversation
	 * that way, or an upward-capable gesture (or user-attributed upward scroll
	 * event) within GESTURE_CHAIN_MS. */
	private gesturedUp(): boolean {
		return (
			this.pointerHeld ||
			this.touchDirection === "up" ||
			performance.now() - this.lastUpGestureAt <= GESTURE_CHAIN_MS
		);
	}

	private gesturedDown(): boolean {
		return (
			this.pointerHeld ||
			this.touchDirection === "down" ||
			performance.now() - this.lastDownGestureAt <= GESTURE_CHAIN_MS
		);
	}

	/** A jump input (scrollbar, keys) within the chain window, or a pointer
	 * still held on the scrollbar. */
	private jumpGestured(): boolean {
		return this.pointerHeld || performance.now() - this.lastJumpGestureAt <= GESTURE_CHAIN_MS;
	}

	private onKeyDown = (event: KeyboardEvent) => {
		// Only a scrolling key the page has not consumed, pressed outside an
		// editable field, scrolls the conversation natively — from the focused
		// scroller or from a control focused inside it. Anything else (typing
		// in a message-edit textarea, a key a widget took, the space that
		// activates a button) moves nothing and must not lend Safari's next
		// clamp the look of user intent.
		if (event.defaultPrevented) return;
		const direction = scrollKeyDirection(event);
		if (!direction || keyConsumedBy(event.target, event.key)) return;
		this.noteGesture(direction);
		this.lastJumpGestureAt = performance.now();
	};

	private onMouseDown = (event: MouseEvent) => {
		// A scrollbar drag lands its mousedown on the container itself: scroll
		// intent from the first pixel. A press on content is a click or the
		// start of a text selection — not scroll intent until it drags (a
		// selection drag auto-scrolls), so it is only remembered here; a click
		// during a stream must not turn Safari's next clamp into a detach.
		// Clicks on controls — the jump buttons live inside the scroller — are
		// never scroll gestures.
		if (event.target instanceof Element && event.target.closest("button, a")) return;
		if (event.target === this.container) {
			this.pointerHeld = true;
			this.noteGesture("both");
			this.lastJumpGestureAt = performance.now();
			return;
		}
		this.pressStart = { x: event.clientX, y: event.clientY };
	};

	private onMouseMove = (event: MouseEvent) => {
		const start = this.pressStart;
		if (!start) return;
		if (Math.abs(event.clientX - start.x) < 4 && Math.abs(event.clientY - start.y) < 4) return;
		// The press became a drag (a text selection): scroll intent from here.
		this.pressStart = null;
		this.pointerHeld = true;
		this.noteGesture("both");
	};

	private onWindowMouseUp = () => {
		this.pressStart = null;
		if (!this.pointerHeld) return;
		this.pointerHeld = false;
		this.noteGesture("both");
		this.lastJumpGestureAt = performance.now();
	};

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
		// Stamp only a wheel that can actually move the conversation, in the
		// direction it can move it: a pinch, a horizontal pan, a wheel at the
		// edge it points to, or one a nested scroller consumes moves nothing —
		// and must not lend Safari's next clamp the look of user intent.
		if (event.ctrlKey) return; // pinch-zoom
		if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return; // horizontal pan
		const deltaY = this.normalizeWheelDelta(event);
		if (deltaY === 0) return;
		const direction = deltaY < 0 ? "up" : "down";
		if (
			direction === "up"
				? this.clampedTop() <= AT_BOTTOM_EPS
				: this.distanceFromBottom() <= AT_BOTTOM_EPS
		) {
			return;
		}
		if (this.innerScrollerConsumes(event.target, direction)) return;
		this.noteGesture(direction);
		// An upward wheel during a glide takes the view; a downward one leaves
		// the glide running toward where the user wants to go anyway.
		if (direction === "up" && this.anim && !this.anim.snap) this.unpin();
	};

	private distanceFromBottom(): number {
		return this.maxScrollTop() - this.clampedTop();
	}

	/**
	 * True when a scrollable element between `target` and the container can
	 * still scroll in `direction`: the browser hands the wheel or drag to it,
	 * the conversation does not move, and the input says nothing about it.
	 * The ancestor walk forces layout; it runs once per wheel/touch event.
	 */
	private innerScrollerConsumes(target: EventTarget | null, direction: "up" | "down"): boolean {
		let el = target instanceof Element ? target : null;
		while (el && el !== this.container) {
			if (el instanceof HTMLElement && el.scrollHeight > el.clientHeight + 1) {
				const room =
					direction === "up"
						? el.scrollTop > 0
						: el.scrollTop < el.scrollHeight - el.clientHeight - 1;
				if (room) {
					const overflowY = getComputedStyle(el).overflowY;
					if (overflowY === "auto" || overflowY === "scroll") return true;
				}
			}
			el = el.parentElement;
		}
		return false;
	}

	private onTouchStart = (event: TouchEvent) => {
		const t = event.touches.length === 1 ? event.touches[0] : null;
		// A touch in the edge-swipe zone belongs to the host's drawer gesture:
		// it will not scroll the conversation, so it says nothing about a glide.
		// A tap says nothing either: a touch is a gesture once it has moved.
		const tracked = t !== null && t.clientX >= this.opts.ignoreTouchZonePx;
		this.lastTouchY = tracked ? t.clientY : null;
		this.lastTouchX = tracked ? t.clientX : null;
		this.touchStart = tracked ? { x: t.clientX, y: t.clientY } : null;
		this.touchHeld = false;
		this.touchDirection = null;
	};

	private onTouchMove = (event: TouchEvent) => {
		if (event.touches.length !== 1) {
			this.lastTouchY = null;
			this.lastTouchX = null;
			this.touchStart = null;
			this.touchHeld = false;
			this.touchDirection = null;
			return;
		}
		const y = event.touches[0].clientY;
		const x = event.touches[0].clientX;
		const lastY = this.lastTouchY;
		const lastX = this.lastTouchX;
		const start = this.touchStart;
		if (lastY === null || lastX === null || !start) return; // ignored (edge zone) or multi-touch
		this.lastTouchY = y;
		this.lastTouchX = x;
		if (!this.touchHeld) {
			// A touch is a gesture once it has traveled vertically. A tap, or a
			// swipe along a horizontally scrolling code block, moves the
			// conversation nowhere: it stamps nothing, and the finger it keeps
			// down must not lend Safari's next clamp the look of user intent.
			const dx = Math.abs(x - start.x);
			const dy = Math.abs(y - start.y);
			if (dy < 4 || dx > dy) return;
			this.touchHeld = true;
		}
		// Finger down = content up. A move counts — as a stamp, and as the held
		// finger's direction — only when the conversation can follow it: a
		// finger pushing against the edge it is at (the reflex of asking for
		// more while following at the bottom), or one a nested code block
		// scrolls with, moves the conversation nowhere and must not lend
		// Safari's next clamp the look of user intent. A mostly-horizontal move
		// (a swipe with slight vertical drift) says nothing either.
		if (y === lastY || Math.abs(y - lastY) < Math.abs(x - lastX)) return;
		const direction = y > lastY ? "up" : "down";
		const movable =
			(direction === "up"
				? this.clampedTop() > AT_BOTTOM_EPS
				: this.distanceFromBottom() > AT_BOTTOM_EPS) &&
			!this.innerScrollerConsumes(event.target, direction);
		this.touchDirection = movable ? direction : null;
		if (!movable) return;
		this.noteGesture(direction);
		// An active finger dragging AWAY from the bottom (finger down = content
		// up) during a glide takes the view. Drags toward the bottom leave the
		// glide running — it is already going where they want, and the geometric
		// re-attach rule covers them if it gets canceled elsewhere. Momentum
		// after the finger lifts sends no touchmove, but its scroll events carry
		// direction and the geometric rules handle them.
		if (direction === "up" && y > lastY + 1 && this.anim && !this.anim.snap) this.unpin();
	};

	private onTouchEnd = () => {
		// Momentum follows the lift: its scroll events chain off the last move's
		// stamp; a tap that never moved leaves no stamp at all.
		this.touchHeld = false;
		this.touchDirection = null;
		this.touchStart = null;
		this.lastTouchY = null;
		this.lastTouchX = null;
	};
}

/** The direction a key scrolls a focused scroller natively, or null for a key that does not scroll. */
function scrollKeyDirection(event: KeyboardEvent): "up" | "down" | null {
	switch (event.key) {
		case "PageUp":
		case "ArrowUp":
		case "Home":
			return "up";
		case "PageDown":
		case "ArrowDown":
		case "End":
			return "down";
		case " ":
			return event.shiftKey ? "up" : "down";
		default:
			return null;
	}
}

/** An editable field takes its keys; a control takes the space that activates it. */
function keyConsumedBy(target: EventTarget | null, key: string): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (
		target.isContentEditable ||
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement
	) {
		return true;
	}
	return key === " " && target.closest("button, a, summary, [role='button']") !== null;
}
