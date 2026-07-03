import { navigating } from "$app/state";
import { tick } from "svelte";

// Threshold to determine if user is "at bottom" - larger value prevents false detachment
const BOTTOM_THRESHOLD = 50;
const USER_SCROLL_DEBOUNCE_MS = 150;
const PROGRAMMATIC_SCROLL_GRACE_MS = 100;
const TOUCH_DETACH_THRESHOLD_PX = 10;
// How long after a programmatic scroll a phantom (non-user) scroll on touch
// devices is still treated as a stale async application and corrected.
const STALE_SCROLL_WINDOW_MS = 2000;
// Momentum scroll events keep arriving well after the touch-debounce expires;
// an up-scroll this soon after touch contact is still the user's flick.
const TOUCH_MOMENTUM_WINDOW_MS = 2500;

interface ScrollDependency {
	forceReattach?: number;
	scrollBehavior?: ScrollBehavior;
}

type MaybeScrollDependency = ScrollDependency | unknown;

const getForceReattach = (value: MaybeScrollDependency): number => {
	if (typeof value === "object" && value !== null && "forceReattach" in value) {
		return (value as ScrollDependency).forceReattach ?? 0;
	}
	return 0;
};

const getScrollBehavior = (value: MaybeScrollDependency): ScrollBehavior => {
	if (typeof value === "object" && value !== null && "scrollBehavior" in value) {
		return (value as ScrollDependency).scrollBehavior ?? "instant";
	}
	return "instant";
};

/**
 * Auto-scroll action that snaps to bottom while respecting user scroll intent.
 *
 * Key behaviors:
 * 1. Uses wheel/touch events to detect actual user intent
 * 2. Uses IntersectionObserver on a sentinel element to reliably detect "at bottom" state
 * 3. Larger threshold to prevent edge-case false detachments
 *
 * @param node element to snap scroll to bottom
 * @param dependency pass in { forceReattach } - forceReattach (counter) forces
 *                   scroll to bottom when incremented (e.g. user sends a new message)
 */
export const snapScrollToBottom = (node: HTMLElement, dependency: MaybeScrollDependency) => {
	// --- State ----------------------------------------------------------------

	// Scrollbar drags only exist on fine-pointer devices; on touch devices all
	// genuine user scrolling raises touch events first.
	const isCoarsePointer =
		typeof window !== "undefined" && window.matchMedia("(any-pointer: coarse)").matches;

	// Track whether user has intentionally scrolled away from bottom
	let isDetached = false;

	// Track the last forceReattach value to detect changes
	let lastForceReattach = getForceReattach(dependency);

	// Track if user is actively scrolling (via wheel/touch)
	let userScrolling = false;
	let userScrollTimeout: ReturnType<typeof setTimeout> | undefined;

	// Track programmatic scrolls to avoid treating them as user scrolls
	let isProgrammaticScroll = false;
	let lastProgrammaticScrollTime = 0;

	// Track previous scroll position to detect scrollbar drags
	let prevScrollTop = node.scrollTop;
	// Track previous scroll height: a scrollTop drop that coincides with a
	// scrollHeight change is a layout shift (e.g. the thinking block collapsing),
	// not a user scroll-up.
	let prevScrollHeight = node.scrollHeight;

	// Touch handling state
	let touchStartY = 0;
	let lastTouchTime = 0;

	// Observers and sentinel
	let resizeObserver: ResizeObserver | undefined;
	let intersectionObserver: IntersectionObserver | undefined;
	let sentinel: HTMLDivElement | undefined;

	// --- Helpers --------------------------------------------------------------

	const clearUserScrollTimeout = () => {
		if (userScrollTimeout) {
			clearTimeout(userScrollTimeout);
			userScrollTimeout = undefined;
		}
	};

	const distanceFromBottom = () => node.scrollHeight - node.scrollTop - node.clientHeight;

	const isAtBottom = () => distanceFromBottom() <= BOTTOM_THRESHOLD;

	const scrollToBottom = (behavior: ScrollBehavior = "instant") => {
		isProgrammaticScroll = true;
		lastProgrammaticScrollTime = Date.now();

		node.scrollTo({ top: node.scrollHeight, behavior });

		if (typeof requestAnimationFrame === "function") {
			requestAnimationFrame(() => {
				isProgrammaticScroll = false;
				// iOS Safari applies rapid successive scrollTo calls asynchronously and
				// can land them out of order: a clamp computed against a transient short
				// layout (e.g. the thinking block collapsing mid-stream) may stomp a
				// later, correct scroll. Verify after paint and correct once.
				if (!isDetached && !userScrolling && distanceFromBottom() > BOTTOM_THRESHOLD) {
					lastProgrammaticScrollTime = Date.now();
					node.scrollTo({ top: node.scrollHeight });
				}
			});
		} else {
			isProgrammaticScroll = false;
		}
	};

	const scheduleUserScrollEndCheck = () => {
		userScrolling = true;
		clearUserScrollTimeout();

		userScrollTimeout = setTimeout(() => {
			userScrolling = false;

			// If user scrolled back to bottom, re-attach
			if (isAtBottom()) {
				isDetached = false;
			}
		}, USER_SCROLL_DEBOUNCE_MS);
	};

	const createSentinel = () => {
		sentinel = document.createElement("div");
		sentinel.style.height = "1px";
		sentinel.style.width = "100%";
		sentinel.setAttribute("aria-hidden", "true");
		sentinel.setAttribute("data-scroll-sentinel", "");

		// Find the content container (first child) and append sentinel there
		const container = node.firstElementChild;
		if (container) {
			container.appendChild(sentinel);
		} else {
			node.appendChild(sentinel);
		}
	};

	const setupIntersectionObserver = () => {
		if (typeof IntersectionObserver === "undefined" || !sentinel) return;

		intersectionObserver = new IntersectionObserver(
			(entries) => {
				const entry = entries[0];

				// If sentinel is visible and user isn't actively scrolling, we're at bottom
				if (entry?.isIntersecting && !userScrolling) {
					isDetached = false;
				}
			},
			{
				root: node,
				threshold: 0,
				rootMargin: `0px 0px ${BOTTOM_THRESHOLD}px 0px`,
			}
		);

		intersectionObserver.observe(sentinel);
	};

	const setupResizeObserver = () => {
		if (typeof ResizeObserver === "undefined") return;

		const target = node.firstElementChild ?? node;
		resizeObserver = new ResizeObserver(() => {
			// Don't auto-scroll if user has detached and we're not navigating
			if (isDetached && !navigating.to) return;
			// Don't interrupt active user scrolling
			if (userScrolling) return;

			scrollToBottom();
		});

		resizeObserver.observe(target);
	};

	// --- Action update logic --------------------------------------------------

	const handleForceReattach = async (newDependency: MaybeScrollDependency) => {
		const forceReattach = getForceReattach(newDependency);

		if (forceReattach > lastForceReattach) {
			lastForceReattach = forceReattach;
			isDetached = false;
			userScrolling = false;
			clearUserScrollTimeout();

			await tick();
			scrollToBottom(getScrollBehavior(newDependency));
			return true;
		}

		return false;
	};

	async function updateScroll(newDependency?: MaybeScrollDependency) {
		if (newDependency) {
			await handleForceReattach(newDependency);
		}
	}

	// --- Event handlers -------------------------------------------------------

	// Detect user scroll intent via wheel events (mouse/trackpad)
	const handleWheel = (event: WheelEvent) => {
		const { deltaY } = event;

		// User is scrolling up - detach
		if (deltaY < 0) {
			isDetached = true;
		}

		// User is scrolling down - check for re-attachment immediately
		// This ensures fast re-attachment when user scrolls to bottom during fast generation
		if (deltaY > 0 && isAtBottom()) {
			isDetached = false;
			userScrolling = false;
			clearUserScrollTimeout();
			scrollToBottom();
			return;
		}

		scheduleUserScrollEndCheck();
	};

	// Detect user scroll intent via touch events (mobile)
	const handleTouchStart = (event: TouchEvent) => {
		lastTouchTime = Date.now();
		touchStartY = event.touches[0]?.clientY ?? 0;
	};

	const handleTouchMove = (event: TouchEvent) => {
		lastTouchTime = Date.now();
		const touchY = event.touches[0]?.clientY ?? 0;
		const deltaY = touchStartY - touchY;

		// User is scrolling up (finger moving down)
		if (deltaY < -TOUCH_DETACH_THRESHOLD_PX) {
			isDetached = true;
		}

		// User is scrolling down (finger moving up) - check for re-attachment immediately
		if (deltaY > TOUCH_DETACH_THRESHOLD_PX && isAtBottom()) {
			isDetached = false;
			userScrolling = false;
			clearUserScrollTimeout();
			scrollToBottom();
			touchStartY = touchY;
			return;
		}

		scheduleUserScrollEndCheck();
		touchStartY = touchY;
	};

	// Handle scroll events to detect scrollbar usage and re-attach when at bottom
	const handleScroll = () => {
		const now = Date.now();
		const timeSinceLastProgrammaticScroll = now - lastProgrammaticScrollTime;
		const inGracePeriod =
			isProgrammaticScroll || timeSinceLastProgrammaticScroll < PROGRAMMATIC_SCROLL_GRACE_MS;

		// If not from wheel/touch, this is likely a scrollbar drag
		if (!userScrolling) {
			const scrollingUp = node.scrollTop < prevScrollTop;
			// A scrollTop drop that coincides with a scrollHeight change is a layout
			// shift, not user intent.
			const heightChanged = node.scrollHeight !== prevScrollHeight;

			// A scrollTop drop here is only a user signal on fine-pointer devices
			// (scrollbar drag). On touch devices every real user scroll arrives via
			// the touch handlers; what lands here instead is iOS Safari applying
			// stale queued scrolls (e.g. a clamp computed while the thinking-block
			// collapse briefly shortened the layout), sometimes 100ms+ late.
			if (scrollingUp && !inGracePeriod && !heightChanged && !isCoarsePointer) {
				isDetached = true;
			} else if (isCoarsePointer && scrollingUp && now - lastTouchTime < TOUCH_MOMENTUM_WINDOW_MS) {
				// Momentum tail of a user flick (arrives after the touch debounce
				// cleared userScrolling): honor it as user intent.
				isDetached = true;
			} else if (
				isCoarsePointer &&
				!isDetached &&
				scrollingUp &&
				!isAtBottom() &&
				now - lastProgrammaticScrollTime < STALE_SCROLL_WINDOW_MS
			) {
				// Phantom scroll (stale async application, no touch anywhere near):
				// it stranded us off-bottom while following, so correct it.
				scrollToBottom();
			}

			// Only re-attach when at bottom if NOT in grace period
			// (avoids false re-attach from content resize pushing scroll position)
			if (!inGracePeriod && isAtBottom()) {
				isDetached = false;
				// Immediately scroll to catch up with any content that arrived while detached
				scrollToBottom();
			}
		}

		prevScrollTop = node.scrollTop;
		prevScrollHeight = node.scrollHeight;
	};

	// --- Setup ----------------------------------------------------------------

	node.addEventListener("wheel", handleWheel, { passive: true });
	node.addEventListener("touchstart", handleTouchStart, { passive: true });
	node.addEventListener("touchmove", handleTouchMove, { passive: true });
	node.addEventListener("scroll", handleScroll, { passive: true });

	createSentinel();
	setupIntersectionObserver();
	setupResizeObserver();

	// Initial scroll if we have content
	if (dependency) {
		void (async () => {
			await tick();
			scrollToBottom();
		})();
	}

	// --- Cleanup --------------------------------------------------------------

	return {
		update: updateScroll,
		destroy: () => {
			clearUserScrollTimeout();

			node.removeEventListener("wheel", handleWheel);
			node.removeEventListener("touchstart", handleTouchStart);
			node.removeEventListener("touchmove", handleTouchMove);
			node.removeEventListener("scroll", handleScroll);

			resizeObserver?.disconnect();
			intersectionObserver?.disconnect();
			sentinel?.remove();
		},
	};
};
