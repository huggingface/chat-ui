/**
 * Chat-specific orchestration on top of StickToBottomController.
 *
 * Owns the anchored-turn latch (which turn currently holds the reservation a
 * reply streams into — see docs/scroll/foundations/turn-reservation.md) and
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
	/** The trailing turn's key while its reply is streaming, else null: the
	 * caller passes `loading && trailing message is the assistant's` — the
	 * whole condition for a turn to anchor. Never clears the latch (a settled
	 * turn keeps its reservation); only a conversation switch does. */
	anchorCandidateKey: string | null;
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

	/** The turn currently holding the reservation, by turn key (the id of the
	 * turn's first message). ChatWindow gives the matching turn group its
	 * min-height while it is the last turn. */
	anchoredTurnKey: string | null = $state(null);

	anchorMinHeightPx = $derived(anchorMinHeight(this.viewportHeightPx, this.bottomClearancePx));

	private controller: StickToBottomController | null = null;
	private container: HTMLElement | null = null;
	private contentEl: (() => HTMLElement | null | undefined) | null = null;
	private composerHeight: number | undefined;
	private gutterPx = -1;

	private lastConversationKey: string | undefined;
	private initialized = false;

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
	 * stationary; the controller's clamp rule handles shorter branches. */
	notifyBranchSwitch() {
		this.controller?.unpin();
	}

	/**
	 * Called from a structural $effect (conversation identity, loading, and
	 * message-list shape — deliberately not message content, so it never
	 * re-runs on token flushes).
	 */
	sync(snapshot: ChatScrollSnapshot) {
		const { conversationKey, anchorCandidateKey } = snapshot;

		if (!this.initialized || conversationKey !== this.lastConversationKey) {
			const isFirstRun = !this.initialized;
			this.initialized = true;
			this.lastConversationKey = conversationKey;
			// Adopt silently: a conversation opened mid-stream (resume, or a
			// switch back to a generating one) anchors its streaming turn with
			// no motion beyond the reset's jump.
			this.anchoredTurnKey = anchorCandidateKey;
			if (!isFirstRun) this.reset();
			return;
		}

		if (anchorCandidateKey && anchorCandidateKey !== this.anchoredTurnKey) {
			// A reply started streaming into a turn that wasn't the anchored one:
			// move the reservation there, and carry a still-pinned view to the
			// anchor (one continuous motion with the send's own glide). A user
			// who detached since submitting stays exactly where they are.
			//
			// The pin is deferred one microtask: this runs mid-render-flush, and
			// pinning here would force layout BEFORE the reservation's template
			// binding lands — a regenerate's collapse would clamp against that
			// intermediate geometry and the clamp's scroll event, measured
			// against the final (taller) content, would read as the user
			// scrolling up and detach them. After the flush, shrink and
			// reservation resolve in one layout and the clamp rule holds.
			this.anchoredTurnKey = anchorCandidateKey;
			if (this.state.pinned) {
				const behavior = this.pinBehaviorForSend();
				queueMicrotask(() => {
					if (this.state.pinned) this.controller?.pin(behavior);
				});
			}
		}
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
