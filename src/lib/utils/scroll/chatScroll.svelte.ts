/**
 * Chat-specific orchestration on top of StickToBottomController.
 *
 * Owns the intent model that used to be inferred from fragile message-array
 * diffs ("+2 messages with an empty assistant", "first message id changed"):
 * the code that KNOWS what happened (send / edit / regenerate / branch switch /
 * conversation switch) arms an explicit intent, and the structural effect only
 * decides WHEN the awaited DOM change has mounted — never WHAT it means.
 *
 * Also owns the send-anchor spacer element imperatively (measurement-driven
 * style, not template state), and exposes reactive state for the floating
 * scroll buttons so they carry no listeners of their own.
 */

import type { Message } from "$lib/types/Message";
import { StickToBottomController, type StickToBottomState } from "./stickToBottom";
import {
	computeSpacerHeight,
	minSpacerHeight,
	MIN_SPACER_FALLBACK_PX,
	SPACER_TOP_OFFSET_PX,
} from "./spacer";

/** Hysteresis for the floating buttons: appear past SHOW, stay until within
 * HIDE — so the boundary never flickers while reading near the threshold. */
const BUTTONS_SHOW_PX = 200;
const BUTTONS_HIDE_PX = 60;
/** Landing offset for scroll-to-previous — the same breathing room as the
 * send anchor, instead of the old flush-against-the-edge scrollIntoView. */
const PREVIOUS_TOP_OFFSET_PX = SPACER_TOP_OFFSET_PX;
/**
 * An armed send/retry intent that hasn't seen its DOM change within this
 * window is stale and must not fire later. Generous because the send pipeline
 * legitimately awaits attachment encoding and MCP hydration before the pair
 * mounts; firing late is safe because consumption additionally requires a
 * trailing assistant message that did NOT exist at arm time and is still
 * empty — no other structural change (branch switch, refresh) matches that.
 */
const INTENT_TTL_MS = 60_000;

interface Intent {
	kind: "send" | "retry";
	armedAt: number;
	/** Visible message ids at arm time — the awaited pair must be new. */
	knownIds: ReadonlySet<string>;
	/** Visible message count at arm time — send/edit mounts exactly +2, which
	 * identifies the pair even when the first token lands in the same flush. */
	countAtArm: number;
	/** Set when the user detaches between arm and consume: keep the spacer
	 * geometry but never yank them back to the bottom. */
	skipPin: boolean;
}

export interface ChatScrollSnapshot {
	conversationKey: string | undefined;
	messages: Pick<Message, "id" | "from">[];
	/** Whether the trailing message has empty content — read untracked by the
	 * caller so token flushes don't re-run the structural effect. */
	lastMessageEmpty: boolean;
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
	 * during the send glide and whenever spring lag transiently exceeds the
	 * threshold mid-stream). */
	private buttonsVisible = $state(false);

	showJumpToBottom = $derived(this.buttonsVisible);
	showJumpToPrevious = $derived(this.buttonsVisible && this.state.scrolledUp);

	/** Half of the measured scrollbar gutter, for the composer's alignment
	 * padding (see measureGutter). Bound into a CSS variable by ChatWindow. */
	gutterHalfPx = $state(0);

	private controller: StickToBottomController | null = null;
	private container: HTMLElement | null = null;
	private spacerEl: HTMLElement | null = null;
	private contentEl: (() => HTMLElement | null | undefined) | null = null;

	private intent: Intent | null = null;
	/** True while a send anchor is active for the current turn. */
	private spacerActive = false;
	/** True while a response is streaming (mirrors ChatWindow's loading prop) —
	 * the window in which the spacer is one-way (shrink-only), because a reader
	 * follows the live edge BELOW any collapsing block and re-anchoring would
	 * yank the text they're reading. Outside it, re-inflation is what keeps a
	 * post-turn collapse (manual toggle, end-of-stream auto-collapse) perfectly
	 * still: constant scrollHeight means nothing moves at all. */
	private streaming = false;
	/** The anchored user message element, resolved once per turn — updateSpacer
	 * runs on every streaming frame and must not rescan the whole subtree. */
	private anchorEl: Element | null = null;
	/** Set by notifyBranchSwitch so the branch switch's own structural change
	 * can never consume an armed send/retry intent (e.g. by landing on an
	 * empty errored sibling, which is structurally identical to a fresh pair). */
	private pendingBranchSwitch = false;
	/** True while an unpin is programmatic (branch switch), so applyState does
	 * not read it as the user revoking an armed intent's pin. */
	private suppressSkipPin = false;
	private composerHeight: number | undefined;
	private gutterPx = -1;

	private lastConversationKey: string | undefined;
	private lastMessageCount = 0;
	private lastLastMessageId: string | undefined;
	private knownIds: ReadonlySet<string> = new Set();
	private initialized = false;

	/**
	 * Safari has no native scroll anchoring (`overflow-anchor` unsupported), so
	 * content changes above the viewport — a thinking block collapsing, a late
	 * image, a markdown swap — shove a detached reader's text by the full
	 * height delta. Where native anchoring is unavailable, track the element at
	 * the viewport top while detached and manually restore its position after
	 * content resizes: the same job Chrome's anchoring does.
	 */
	private manualAnchoring: boolean;
	/** Viewport-top anchor as a deepest-first ancestor chain (markdown worker
	 * swaps and streaming re-renders REPLACE deep nodes, so compensation falls
	 * back to the nearest still-connected ancestor instead of going silent),
	 * plus the scrollTop it was captured at: a mismatch at compensation time
	 * means a user scroll is pending in the same pass, and compensating from
	 * the stale capture would cancel their movement. */
	private readAnchor: { chain: { el: Element; offset: number }[]; top: number } | null = null;

	constructor(options: { forceManualAnchoring?: boolean } = {}) {
		this.manualAnchoring =
			options.forceManualAnchoring ??
			(typeof CSS !== "undefined" && !CSS.supports("overflow-anchor", "auto"));
	}

	// --- wiring -------------------------------------------------------------------

	/** `use:` action for the scroll container. */
	attach = (
		node: HTMLElement,
		params?: {
			content?: () => HTMLElement | null | undefined;
			ignoreTouchZonePx?: number;
		}
	) => {
		this.container = node;
		this.contentEl = params?.content ?? null;
		this.controller = new StickToBottomController(node, {
			content: () => this.contentEl?.() ?? undefined,
			ignoreTouchZonePx: params?.ignoreTouchZonePx,
			onStateChange: (s) => this.applyState(s),
			onContentResize: (containerResized) => {
				if (containerResized) this.measureGutter();
				this.compensateReadAnchor();
				// Container resizes (keyboard close, window resize, panel toggle)
				// re-derive the anchor geometry in full; pure content resizes are
				// one-way within a turn (see updateSpacer).
				this.updateSpacer(containerResized);
			},
		});
		this.measureGutter();
		if (this.manualAnchoring) {
			node.addEventListener("scroll", this.trackReadAnchor, { passive: true });
		}
		// Land at the bottom before first paint; being pinned makes the
		// ResizeObserver absorb the async markdown/image height changes that
		// used to leave the view off-bottom on load.
		this.controller.jumpToBottom();

		// The iOS keyboard resizes only the visual viewport — no ResizeObserver
		// fires anywhere. Without this, the send anchor breaks the moment the
		// keyboard closes after a mobile send.
		const visualViewport = typeof window !== "undefined" ? window.visualViewport : null;
		const onViewportResize = () => this.controller?.recompute();
		visualViewport?.addEventListener("resize", onViewportResize);

		return {
			destroy: () => {
				visualViewport?.removeEventListener("resize", onViewportResize);
				node.removeEventListener("scroll", this.trackReadAnchor);
				this.controller?.destroy();
				this.controller = null;
				this.container = null;
			},
		};
	};

	/** Record the element at the viewport top (binary search over the content
	 * children — they are in document order — then a descent into the
	 * straddling message). Only while detached — pinned following owns the
	 * bottom edge instead. */
	private trackReadAnchor = () => {
		if (!this.manualAnchoring) return;
		if (this.state.pinned || !this.container) {
			this.readAnchor = null;
			return;
		}
		const content = this.contentEl?.();
		const children = content?.children;
		if (!content || !children || children.length === 0) {
			this.readAnchor = null;
			return;
		}
		const containerTop = this.container.getBoundingClientRect().top;
		let lo = 0;
		let hi = children.length - 1;
		let found = children.length - 1;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			if (children[mid].getBoundingClientRect().bottom > containerTop + 1) {
				found = mid;
				hi = mid - 1;
			} else {
				lo = mid + 1;
			}
		}
		// Descend into the straddling message: anchoring the outer wrapper
		// misses changes INSIDE it — a thinking block collapsing above the
		// reading position within the same long message leaves the wrapper's
		// top unchanged while the visible paragraph moves. Native anchoring
		// anchors deep descendants; do the same. Linear scans here (unlike the
		// top level) because in-message children are few and can be positioned
		// out of flow, which breaks the binary search's ordering assumption.
		let el: Element = children[found];
		for (let depth = 0; depth < 8; depth++) {
			const inner = this.firstChildBelow(el, containerTop);
			if (!inner) break;
			el = inner;
		}
		// Store the whole ancestor chain (deepest first, up to the content
		// root): if a re-render replaces the deep node, its ancestors still
		// carry enough position to compensate cross-message shifts.
		const chain: { el: Element; offset: number }[] = [];
		for (let node: Element | null = el; node && node !== content; node = node.parentElement) {
			chain.push({ el: node, offset: node.getBoundingClientRect().top - containerTop });
		}
		this.readAnchor = { chain, top: this.container.scrollTop };
	};

	private firstChildBelow(parent: Element, containerTop: number): Element | null {
		const kids = parent.children;
		for (let i = 0; i < kids.length; i++) {
			const rect = kids[i].getBoundingClientRect();
			if (rect.height > 0 && rect.bottom > containerTop + 1) return kids[i];
		}
		return null;
	}

	/** After a content resize while detached, restore the tracked element's
	 * viewport position — Safari's stand-in for native scroll anchoring. The
	 * adjustment goes through the controller, so attribution stays sound (its
	 * write is consumed like any of ours). */
	private compensateReadAnchor() {
		if (!this.manualAnchoring || this.state.pinned || !this.container) return;
		const anchor = this.readAnchor;
		if (!anchor?.chain.length) return;
		// A scrollTop that moved since capture means a user scroll (or clamp)
		// is pending in this very pass — resize delivery is not ordered after
		// scroll events. The captured offsets then include that unprocessed
		// movement, and "compensating" would cancel the user's scroll. Skip
		// this pass (one uncompensated frame is invisible; fighting the user's
		// finger is not) and re-capture below.
		const stale = Math.abs(this.container.scrollTop - anchor.top) > 1;
		if (!stale) {
			// The deep anchor may have been replaced by this very resize
			// (markdown worker swap, streaming re-render) — fall back to the
			// nearest ancestor that survived, which still compensates every
			// shift originating above it. Intra-ancestor changes from the
			// replacing pass itself are unrecoverable (the old node's geometry
			// died with it).
			const entry = anchor.chain.find((e) => e.el.isConnected);
			if (entry) {
				const containerTop = this.container.getBoundingClientRect().top;
				const delta = entry.el.getBoundingClientRect().top - containerTop - entry.offset;
				if (Math.abs(delta) >= 1) this.controller?.adjustBy(delta);
			}
		}
		// Always re-resolve a fresh anchor for the NEXT pass (the write may
		// have been clamped, and a replaced node must not leave a stale chain —
		// that would silence compensation until the next user scroll).
		this.trackReadAnchor();
	}

	/** `use:` action for the send-anchor spacer element. */
	attachSpacer = (node: HTMLElement) => {
		this.spacerEl = node;
		node.style.height = `${this.minSpacer()}px`;
		return {
			destroy: () => {
				this.spacerEl = null;
			},
		};
	};

	/** The growing content element can be created after the container (empty
	 * conversation gaining its first messages) — re-check the observer then. */
	notifyContentChanged() {
		this.controller?.recompute();
	}

	/** Mirror of ChatWindow's loading prop. Only a flag flip: no recompute here,
	 * so the transition itself can never cause motion (an end-of-stream
	 * recompute could re-inflate a floored spacer and glide the view — the
	 * #2381 class of bug). The next real resize simply sees the new regime. */
	setStreaming(streaming: boolean) {
		this.streaming = streaming;
	}

	setComposerHeight(height: number | undefined) {
		if (height === this.composerHeight) return;
		this.composerHeight = height;
		if (!this.spacerEl) return;
		if (this.spacerActive) {
			// Mid-turn the full geometry decides (the floor is one input).
			this.updateSpacer();
		} else {
			// Outside a turn the spacer IS the floor: grow it so a taller
			// composer never occludes the reply, and shrink it back when the
			// draft is deleted (a ratchet would leave a permanent dead gap).
			this.spacerEl.style.height = `${this.minSpacer()}px`;
		}
		this.controller?.recompute();
	}

	// --- intents --------------------------------------------------------------------

	/** User submitted a message (send, or edit-with-content: both mount a fresh
	 * (user, assistant) pair that should anchor near the viewport top). */
	armSend() {
		this.intent = {
			kind: "send",
			armedAt: Date.now(),
			knownIds: this.knownIds,
			countAtArm: this.lastMessageCount,
			skipPin: false,
		};
	}

	/** User regenerated an assistant message: prepare the spacer so the old
	 * reply's collapse doesn't clamp-jump the view, but never yank a user who
	 * regenerates from a scrolled-up position. */
	armRetry() {
		this.intent = {
			kind: "retry",
			armedAt: Date.now(),
			knownIds: this.knownIds,
			countAtArm: this.lastMessageCount,
			skipPin: false,
		};
	}

	/** Branch/alternative switch: the compared message must stay put. Content
	 * above the branch point is untouched, so simply disengaging the follow
	 * keeps it stationary; the controller's clamp rule handles shorter branches.
	 * The unpin is programmatic — it must not revoke an in-flight send's pin —
	 * and the switch's own structural change must not consume that intent. */
	notifyBranchSwitch() {
		this.pendingBranchSwitch = true;
		this.suppressSkipPin = true;
		this.controller?.unpin();
		this.suppressSkipPin = false;
	}

	/**
	 * Called from a structural $effect that tracks conversation identity and
	 * message-list shape (ids/length — deliberately not message content, so it
	 * never re-runs on token flushes).
	 */
	sync(snapshot: ChatScrollSnapshot) {
		const { conversationKey, messages } = snapshot;
		const lastMessage = messages.at(-1);

		if (!this.initialized || conversationKey !== this.lastConversationKey) {
			const isFirstRun = !this.initialized;
			this.initialized = true;
			this.lastConversationKey = conversationKey;
			this.trackStructure(messages);
			if (!isFirstRun) this.reset();
			return;
		}

		const structureChanged =
			messages.length !== this.lastMessageCount || lastMessage?.id !== this.lastLastMessageId;
		this.trackStructure(messages);
		if (!structureChanged) return;

		// A branch switch produces exactly one structural change; it can never
		// be the awaited pair (even when its leaf is an empty errored sibling,
		// which is structurally indistinguishable from a fresh one).
		const wasBranchSwitch = this.pendingBranchSwitch;
		this.pendingBranchSwitch = false;

		const intent = this.intent;
		if (!intent || wasBranchSwitch) return;
		if (Date.now() - intent.armedAt > INTENT_TTL_MS) {
			this.intent = null;
			return;
		}

		// The awaited change and nothing else: a trailing assistant message that
		// did not exist when the intent was armed, and that is either still
		// empty or part of an exact +2 growth (send/edit pair — robust against
		// the first token landing in the same flush as the mount). Retry flows
		// reassign the visible path to the OLD branch's leaf one flush before
		// the tree mutation; that leaf is a known id and is skipped.
		if (
			lastMessage?.from !== "assistant" ||
			intent.knownIds.has(lastMessage.id) ||
			(!snapshot.lastMessageEmpty && messages.length !== intent.countAtArm + 2)
		) {
			return;
		}
		this.intent = null;

		if (intent.kind === "send") {
			// First exchange scrolls plainly (parity with the previous behavior:
			// content starts at the container top, so the sent message anchors
			// there naturally without spacer gymnastics).
			if (messages.length > 2) this.activateSpacer();
			if (!intent.skipPin) this.controller?.pin(this.pinBehaviorForSend());
		} else {
			this.activateSpacer();
			if (!intent.skipPin && this.state.nearBottom) this.controller?.pin("instant");
		}
	}

	private trackStructure(messages: ChatScrollSnapshot["messages"]) {
		this.lastMessageCount = messages.length;
		this.lastLastMessageId = messages.at(-1)?.id;
		this.knownIds = new Set(messages.map((m) => m.id));
	}

	/** Conversation switched: instant bottom, anchor and intents cleared. */
	reset() {
		this.intent = null;
		this.spacerActive = false;
		this.anchorEl = null;
		this.pendingBranchSwitch = false;
		if (this.spacerEl) this.spacerEl.style.height = `${this.minSpacer()}px`;
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

	// --- spacer -----------------------------------------------------------------------

	private minSpacer(): number {
		return minSpacerHeight(this.composerHeight);
	}

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

	private activateSpacer() {
		this.spacerActive = true;
		this.anchorEl = null; // re-resolve for the new turn
		// A fresh turn inflates the spacer freely; within the turn it only shrinks.
		this.updateSpacer(true);
	}

	/** Size the spacer so the anchored user message sits near the viewport top;
	 * runs on every content resize while a turn's anchor is active, shrinking
	 * 1:1 with reply growth to keep scrollHeight constant (zero motion). */
	private updateSpacer(allowGrow = false) {
		if (!this.spacerActive || !this.container || !this.spacerEl) return;

		// Resolve the anchored user message once per turn — this runs every
		// streaming frame, and a full [data-message-type] subtree scan per
		// frame is real jank in long conversations. Re-resolve only if the
		// element left the DOM (branch switch mid-turn).
		if (!this.anchorEl?.isConnected) {
			const userMessages = this.container.querySelectorAll('[data-message-type="user"]');
			this.anchorEl = userMessages[userMessages.length - 1] ?? null;
		}
		const anchor = this.anchorEl;
		if (!anchor) return;

		const anchorToSpacer =
			this.spacerEl.getBoundingClientRect().top - anchor.getBoundingClientRect().top;

		const computed = computeSpacerHeight({
			viewportHeight: this.container.clientHeight,
			anchorToSpacer,
			minSpacer: this.minSpacer(),
			topOffset: SPACER_TOP_OFFSET_PX,
		});

		const current = parseFloat(this.spacerEl.style.height) || MIN_SPACER_FALLBACK_PX;
		// One-way handoff while the stream is live: on pure content changes the
		// spacer only shrinks as the reply grows. Re-inflating on a content
		// SHRINK (a thinking block collapsing at answer-start) would re-anchor
		// the sent message and yank the text a reader is following at the live
		// edge — the shrink rides the controller's clamp rule instead, keeping
		// everything below the collapse viewport-stable. Growth is still allowed
		// at turn start, on container resizes (keyboard close, window resize,
		// panel toggle — the viewport changed, so freezing the stale height
		// would misplace the anchor), and once the stream has settled (there a
		// re-inflation is what absorbs a manual or end-of-stream collapse with
		// zero motion: constant scrollHeight). The composer-clearance floor
		// always wins so a growing composer can never occlude the reply.
		const ceiling = allowGrow || !this.streaming ? Infinity : current;
		const height = Math.max(Math.min(computed, ceiling), this.minSpacer());
		if (Math.abs(current - height) >= 1) {
			this.spacerEl.style.height = `${height}px`;
		}
	}

	/**
	 * `scrollbar-gutter: stable both-edges` narrows the scroller's content box
	 * by the (platform-dependent) gutter width, while the composer overlay is a
	 * sibling centering in the full column — publish the measured half-gutter
	 * reactively (ChatWindow binds it into a CSS variable on markup it owns)
	 * so message text and composer text stay aligned on classic-scrollbar and
	 * overlay-scrollbar platforms alike.
	 */
	private measureGutter() {
		const container = this.container;
		if (!container) return;
		const gutter = container.offsetWidth - container.clientWidth;
		if (gutter === this.gutterPx) return;
		this.gutterPx = gutter;
		this.gutterHalfPx = gutter / 2;
	}

	// --- internals ----------------------------------------------------------------------

	private applyState(s: StickToBottomState) {
		// A USER detaching while a send/retry is in flight (reading up during a
		// slow upload, or mid-fill) revokes that intent's permission to pin;
		// programmatic unpins (branch switch) don't speak for the user.
		if (this.intent && this.state.pinned && !s.pinned && !this.suppressSkipPin) {
			this.intent.skipPin = true;
		}

		Object.assign(this.state, s);

		if (s.pinned || s.distanceFromBottom <= BUTTONS_HIDE_PX) {
			this.buttonsVisible = false;
		} else if (s.distanceFromBottom > BUTTONS_SHOW_PX) {
			this.buttonsVisible = true;
		}
	}
}

export function createChatScroll(options?: { forceManualAnchoring?: boolean }): ChatScroll {
	return new ChatScroll(options);
}
