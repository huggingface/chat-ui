/**
 * Chat-specific orchestration on top of StickToBottomController.
 *
 * Owns the anchored-turn latch (which turn currently holds the reservation a
 * reply streams into) and
 * exposes the reactive numbers ChatWindow binds into its markup: the
 * reservation height, the composer clearance (the message column's bottom
 * padding), the scrollbar half-gutter, and the floating-button visibility.
 *
 * The latch replaces the old intent machinery (armSend/armRetry, known-id
 * sets, TTLs, branch-switch suppression): the anchored turn is *derived* from
 * what is true — a reply is streaming and the trailing message is the
 * assistant's — rather than inferred from message-array diffs. Structure
 * changes that used to need disambiguation (a branch switch landing on an
 * empty errored sibling, a retry's path reassignment) need none: no reply is
 * streaming during them, so nothing latches.
 */

import { StickToBottomController, type StickToBottomState } from "./stickToBottom";
import {
	anchorMinHeight,
	bottomClearance,
	ANCHOR_TOP_OFFSET_PX,
	MIN_CLEARANCE_PX,
} from "./geometry";

/** Hysteresis for the floating buttons: appear past SHOW, stay until within
 * HIDE — so the boundary never flickers while reading near the threshold. */
const BUTTONS_SHOW_PX = 200;
const BUTTONS_HIDE_PX = 60;
/** Landing offset for scroll-to-previous — the same breathing room as the
 * anchored turn. */
const PREVIOUS_TOP_OFFSET_PX = ANCHOR_TOP_OFFSET_PX;

export interface ChatScrollSnapshot {
	conversationKey: string | undefined;
	turnCount: number;
	/** The trailing turn's key, whatever its state — the identity the anchor
	 * follows across the post-stream server reconciliation, which re-keys
	 * every message. */
	lastTurnKey: string | null;
	/** The trailing turn's key while a reply is streaming INTO it (loading,
	 * trailing message is the assistant's, and that message is not already
	 * terminal — the pre-mount gap after a submit still trails the previous,
	 * settled reply, which must not anchor), else null. */
	streamingTurnKey: string | null;
}

export class ChatScroll {
	// Reactive facade consumed by ChatWindow and the buttons.
	state: StickToBottomState = $state({
		pinned: true,
		atBottom: true,
		nearBottom: true,
		scrolledUp: false,
		distanceFromBottom: 0,
	});

	/** Hysteresis latch: buttons never render while pinned (they would flash
	 * during the send glide whenever the gap transiently exceeds the
	 * threshold). */
	private buttonsVisible = $state(false);

	showJumpToBottom = $derived(this.buttonsVisible);
	showJumpToPrevious = $derived(this.buttonsVisible && this.state.scrolledUp);

	/** Half of the measured scrollbar gutter, for the composer's alignment
	 * padding (see measureContainer). Bound into a CSS variable by ChatWindow. */
	gutterHalfPx = $state(0);

	/** Scroll container clientHeight; input to the reservation. Measured on
	 * attach and on container resizes only — never per frame. */
	viewportHeightPx = $state(0);

	/** The message column's bottom padding: content never hides behind the
	 * composer overlay. ChatWindow binds it as an inline style; the SSR-rendered
	 * default equals the historical clearance. */
	bottomClearancePx = $state(MIN_CLEARANCE_PX);

	/** The turn currently holding the reservation, by position. The TEMPLATE
	 * binds min-height to this index, not to the key: the post-stream server
	 * reconciliation re-keys every message, and a key-bound reservation would
	 * blink out for the render in between — an unreserved layout the browser
	 * clamps against, yanking the settled view. Positions survive re-keying,
	 * so the swapped-in turns render with their reservation already on. */
	anchoredTurnIndex: number | null = $state(null);

	/** The anchored turn's key (the id of its first message) — the identity
	 * sync() uses to tell a branch switch (drop the anchor) from the server
	 * re-keying the same turn (carry it over). */
	anchoredTurnKey: string | null = $state(null);

	anchorMinHeightPx = $derived(anchorMinHeight(this.viewportHeightPx, this.bottomClearancePx));

	private controller: StickToBottomController | null = null;
	private container: HTMLElement | null = null;
	private contentEl: (() => HTMLElement | null | undefined) | null = null;
	private composerHeight: number | undefined;
	private gutterPx = -1;

	private lastConversationKey: string | undefined;
	private initialized = false;
	/** Set by notifyBranchSwitch, consumed by the next sync: the switch's
	 * structural change must drop a stale anchor, not carry it over. */
	private pendingBranchSwitch = false;

	// --- wiring -------------------------------------------------------------------

	/** `use:` action for the scroll container. */
	attach = (node: HTMLElement, params?: { content?: () => HTMLElement | null | undefined }) => {
		this.container = node;
		this.contentEl = params?.content ?? null;
		this.controller = new StickToBottomController(node, {
			content: () => this.contentEl?.() ?? undefined,
			onStateChange: (s) => this.applyState(s),
			onContentResize: (containerResized) => {
				if (containerResized) this.measureContainer();
			},
		});
		this.measureContainer();
		// Land at the bottom before first paint; being pinned makes the
		// ResizeObserver absorb the async markdown/image height changes that
		// used to leave the view off-bottom on load.
		this.controller.jumpToBottom();

		// The iOS keyboard resizes only the visual viewport — no ResizeObserver
		// fires anywhere. Without this, the post-send geometry on mobile is
		// computed against the keyboard-shrunk view.
		const visualViewport = typeof window !== "undefined" ? window.visualViewport : null;
		const onViewportResize = () => this.controller?.recompute();
		visualViewport?.addEventListener("resize", onViewportResize);

		return {
			destroy: () => {
				visualViewport?.removeEventListener("resize", onViewportResize);
				this.controller?.destroy();
				this.controller = null;
				this.container = null;
			},
		};
	};

	/** The growing content element can be created after the container (empty
	 * conversation gaining its first messages) — re-check the observer then. */
	notifyContentChanged() {
		this.controller?.recompute();
	}

	setComposerHeight(height: number | undefined) {
		if (height === this.composerHeight) return;
		this.composerHeight = height;
		this.bottomClearancePx = bottomClearance(height);
		this.controller?.recompute();
	}

	// --- turn structure -------------------------------------------------------------

	/** User submitted a message (send, edit-with-content, or a preview's "ask
	 * to fix"): sending is the request to see the exchange, so the view comes
	 * down now — and the engaged pin carries it on to the anchor when the new
	 * turn mounts. An upward scroll at any point revokes this (geometric
	 * unpin), after which nothing yanks the user back. */
	notifySend() {
		this.controller?.pin(this.pinBehaviorForSend());
	}

	/** Branch/alternative switch: the compared message must stay put. Content
	 * above the branch point is untouched, so disengaging the follow keeps it
	 * stationary; the controller's clamp rule handles shorter branches. The
	 * flag lets sync() tell the switch's structural change apart from a
	 * server reconciliation re-keying the same turns (see sync). */
	notifyBranchSwitch() {
		this.pendingBranchSwitch = true;
		this.controller?.unpin();
	}

	/**
	 * Called from a structural $effect (conversation identity, loading, and
	 * message-list shape — deliberately not message content, so it never
	 * re-runs on token flushes).
	 */
	sync(snapshot: ChatScrollSnapshot) {
		const { conversationKey, turnCount, lastTurnKey, streamingTurnKey } = snapshot;

		if (!this.initialized || conversationKey !== this.lastConversationKey) {
			const isFirstRun = !this.initialized;
			this.initialized = true;
			this.lastConversationKey = conversationKey;
			this.pendingBranchSwitch = false;
			// Adopt silently: a conversation opened mid-stream (resume, or a
			// switch back to a generating one) anchors its streaming turn with
			// no motion beyond the reset's jump.
			this.setAnchor(streamingTurnKey, streamingTurnKey ? turnCount - 1 : null);
			if (!isFirstRun) this.reset();
			return;
		}

		const wasBranchSwitch = this.pendingBranchSwitch;
		this.pendingBranchSwitch = false;

		if (streamingTurnKey) {
			if (streamingTurnKey !== this.anchoredTurnKey) {
				// A reply started streaming into a turn that wasn't the anchored
				// one: move the reservation there, and carry a still-pinned view
				// to the anchor (one continuous motion with the send's own
				// glide). A user who detached since submitting stays put.
				//
				// The pin is deferred one microtask: this runs mid-render-flush,
				// and pinning here would force layout BEFORE the reservation's
				// template binding lands — a regenerate's collapse would clamp
				// against that intermediate geometry and the clamp's scroll
				// event, measured against the final (taller) content, would read
				// as the user scrolling up and detach them. After the flush,
				// shrink and reservation resolve in one layout and the clamp
				// rule holds.
				this.setAnchor(streamingTurnKey, turnCount - 1);
				if (this.state.pinned) {
					const behavior = this.pinBehaviorForSend();
					queueMicrotask(() => {
						if (this.state.pinned) this.controller?.pin(behavior);
					});
				}
			}
			return;
		}

		if (this.anchoredTurnKey === null) return;
		if (this.anchoredTurnIndex !== null && this.anchoredTurnIndex >= turnCount) {
			// The anchored position no longer exists (a branch switch onto a
			// shorter path): nothing to reserve.
			this.setAnchor(null, null);
		} else if (lastTurnKey !== this.anchoredTurnKey) {
			if (wasBranchSwitch) {
				// Switched to a branch whose trailing turn is a different one:
				// the reservation does not follow the user across branches.
				// (Cycling alternatives of the anchored turn itself keeps the
				// same turn key — the reservation holds and alternatives of
				// different lengths compare inside a stable box.)
				this.setAnchor(null, null);
			} else if (lastTurnKey && this.anchoredTurnIndex === turnCount - 1) {
				// Same conversation, same trailing turn, new identity: the
				// post-stream server reconciliation re-keys every message.
				// Carry the identity over; the index — which the template
				// renders from — never wavered, so no frame lacked the
				// reservation and the settled view never jumps.
				this.anchoredTurnKey = lastTurnKey;
			} else {
				// The anchored position stopped being the trailing turn without
				// a branch-switch signal (defensive; no current flow does this).
				this.setAnchor(null, null);
			}
		}
	}

	private setAnchor(key: string | null, index: number | null) {
		this.anchoredTurnKey = key;
		this.anchoredTurnIndex = index;
	}

	/** Conversation switched: instant bottom, reservation cleared (any adopted
	 * anchor was already re-set by sync). */
	private reset() {
		this.controller?.jumpToBottom();
	}

	// --- buttons ----------------------------------------------------------------------

	scrollToBottom() {
		// Pins and follows the LIVE bottom — during streaming the target keeps
		// moving and a one-shot scrollTo would land short.
		this.controller?.animateToBottom();
	}

	scrollToPreviousMessage() {
		const container = this.container;
		if (!container) return;
		const containerTop = container.getBoundingClientRect().top;
		// Turn boundaries are how people skim a conversation, so target user
		// messages; fall back to any message for edge shapes (e.g. a leading
		// assistant message).
		const previous =
			this.previousAbove(container, '[data-message-type="user"]', containerTop) ??
			this.previousAbove(container, "[data-message-id]", containerTop);
		if (previous === undefined) return;
		this.controller?.animateTo(container.scrollTop + previous - PREVIOUS_TOP_OFFSET_PX);
	}

	/** Viewport-relative top of the last `selector` element above the viewport
	 * top, or undefined when there is none. */
	private previousAbove(
		container: HTMLElement,
		selector: string,
		containerTop: number
	): number | undefined {
		const elements = container.querySelectorAll(selector);
		for (let i = elements.length - 1; i >= 0; i--) {
			const top = elements[i].getBoundingClientRect().top - containerTop;
			if (top < -1) return top;
		}
		return undefined;
	}

	// --- internals ----------------------------------------------------------------------

	private pinBehaviorForSend(): "instant" | "animate" {
		// iOS suppresses smooth programmatic scrolls during touch/momentum and
		// replays them when the gesture settles — i.e. the view visibly scrolls
		// right as the reply finishes. Snap instantly wherever touch scrolling
		// is possible ('any-pointer: coarse' catches hybrids); glide on desktop.
		if (typeof window !== "undefined" && window.matchMedia("(any-pointer: coarse)").matches) {
			return "instant";
		}
		return "animate";
	}

	/**
	 * `scrollbar-gutter: stable both-edges` narrows the scroller's content box
	 * by the (platform-dependent) gutter width, while the composer overlay is a
	 * sibling centering in the full column — publish the measured half-gutter
	 * reactively (ChatWindow binds it into a CSS variable on markup it owns)
	 * so message text and composer text stay aligned on classic-scrollbar and
	 * overlay-scrollbar platforms alike. The viewport height (the reservation's
	 * input) can likewise only change when the container's box does.
	 */
	private measureContainer() {
		const container = this.container;
		if (!container) return;
		this.viewportHeightPx = container.clientHeight;
		const gutter = container.offsetWidth - container.clientWidth;
		if (gutter === this.gutterPx) return;
		this.gutterPx = gutter;
		this.gutterHalfPx = gutter / 2;
	}

	private applyState(s: StickToBottomState) {
		Object.assign(this.state, s);

		if (s.pinned || s.distanceFromBottom <= BUTTONS_HIDE_PX) {
			this.buttonsVisible = false;
		} else if (s.distanceFromBottom > BUTTONS_SHOW_PX) {
			this.buttonsVisible = true;
		}
	}
}

export function createChatScroll(): ChatScroll {
	return new ChatScroll();
}
