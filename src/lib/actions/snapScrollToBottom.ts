import { navigating } from "$app/state";
import { tick } from "svelte";

// Threshold to determine if user is "at bottom" - larger value prevents false detachment
const BOTTOM_THRESHOLD = 50;

/**
 * Auto-scroll action that snaps to bottom while respecting user scroll intent.
 *
 * Key improvements over naive implementations:
 * 1. Uses wheel/touch events to detect actual user intent (not scroll position changes
 *    which can be caused by content resizing above the viewport)
 * 2. Uses IntersectionObserver on a sentinel element to reliably detect "at bottom" state
 * 3. Larger threshold to prevent edge-case false detachments
 *
 * @param node element to snap scroll to bottom
 * @param dependency pass in a dependency to update scroll on changes
 */
export const snapScrollToBottom = (node: HTMLElement, dependency: unknown) => {
	// Track whether user has intentionally scrolled away from bottom
	let isDetached = false;
	// Track if user is actively scrolling (via wheel/touch)
	let userScrolling = false;
	let userScrollTimeout: ReturnType<typeof setTimeout> | undefined;
	// Track programmatic scrolls to avoid treating them as user scrolls
	let isProgrammaticScroll = false;
	// Timestamp of last programmatic scroll to handle race conditions
	let lastProgrammaticScrollTime = 0;

	let resizeObserver: ResizeObserver | undefined;
	let intersectionObserver: IntersectionObserver | undefined;
	let sentinel: HTMLDivElement | undefined;

	// Create a sentinel element at the bottom to observe
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

	const scrollToBottom = () => {
		isProgrammaticScroll = true;
		lastProgrammaticScrollTime = Date.now();
		node.scrollTo({ top: node.scrollHeight });
		// Reset flag after scroll completes
		if (typeof requestAnimationFrame === "function") {
			requestAnimationFrame(() => {
				isProgrammaticScroll = false;
			});
		} else {
			isProgrammaticScroll = false;
		}
	};

	const distanceFromBottom = () => node.scrollHeight - node.scrollTop - node.clientHeight;

	const isAtBottom = () => distanceFromBottom() <= BOTTOM_THRESHOLD;

	async function updateScroll(_options: { force?: boolean } = {}) {
		const options = { force: false, ..._options };
		const { force } = options;

		// Don't scroll if user has detached and we're not navigating
		if (!force && isDetached && !navigating.to) return;

		// Don't scroll if user is actively scrolling
		if (userScrolling) return;

		// Wait for DOM to update
		await tick();
		scrollToBottom();

		// Settle after layout shifts (markdown/image renders)
		if (typeof requestAnimationFrame === "function") {
			await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
			if (!userScrolling && !isDetached) scrollToBottom();
			await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
			if (!userScrolling && !isDetached) scrollToBottom();
		}
	}

	// Detect user scroll intent via wheel events (mouse/trackpad)
	const handleWheel = (e: WheelEvent) => {
		// User is scrolling up - detach
		if (e.deltaY < 0) {
			isDetached = true;
		}

		// Mark user as actively scrolling
		userScrolling = true;
		if (userScrollTimeout) clearTimeout(userScrollTimeout);
		userScrollTimeout = setTimeout(() => {
			userScrolling = false;
			// If user scrolled back to bottom, re-attach
			if (isAtBottom()) {
				isDetached = false;
			}
			// Re-trigger scroll if still attached, to catch content that arrived during scrolling
			if (!isDetached) {
				scrollToBottom();
			}
		}, 150);
	};

	// Detect user scroll intent via touch events (mobile)
	let touchStartY = 0;
	const handleTouchStart = (e: TouchEvent) => {
		touchStartY = e.touches[0]?.clientY ?? 0;
	};

	const handleTouchMove = (e: TouchEvent) => {
		const touchY = e.touches[0]?.clientY ?? 0;
		const deltaY = touchStartY - touchY;

		// User is scrolling up (finger moving down)
		if (deltaY < -10) {
			isDetached = true;
		}

		userScrolling = true;
		if (userScrollTimeout) clearTimeout(userScrollTimeout);
		userScrollTimeout = setTimeout(() => {
			userScrolling = false;
			if (isAtBottom()) {
				isDetached = false;
			}
			// Re-trigger scroll if still attached, to catch content that arrived during scrolling
			if (!isDetached) {
				scrollToBottom();
			}
		}, 150);

		touchStartY = touchY;
	};

	// Track previous scroll position to detect scrollbar drags
	let prevScrollTop = node.scrollTop;

	// Handle scroll events to detect scrollbar usage and re-attach when at bottom
	const handleScroll = () => {
		const timeSinceLastProgrammaticScroll = Date.now() - lastProgrammaticScrollTime;
		const inGracePeriod = isProgrammaticScroll || timeSinceLastProgrammaticScroll < 100;

		// If not from wheel/touch, this is likely a scrollbar drag
		if (!userScrolling) {
			const scrollingUp = node.scrollTop < prevScrollTop;
			// Always allow detach (scrolling up) - don't ignore user intent
			if (scrollingUp) {
				isDetached = true;
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
	};

	// Set up event listeners
	node.addEventListener("wheel", handleWheel, { passive: true });
	node.addEventListener("touchstart", handleTouchStart, { passive: true });
	node.addEventListener("touchmove", handleTouchMove, { passive: true });
	node.addEventListener("scroll", handleScroll, { passive: true });

	// Create sentinel and set up IntersectionObserver for reliable bottom detection
	createSentinel();

	if (typeof IntersectionObserver !== "undefined" && sentinel) {
		intersectionObserver = new IntersectionObserver(
			(entries) => {
				const entry = entries[0];
				// If sentinel is visible and user isn't actively scrolling, we're at bottom
				if (entry?.isIntersecting && !userScrolling) {
					isDetached = false;
					// Immediately scroll to catch up with any content that arrived while detached
					scrollToBottom();
				}
			},
			{
				root: node,
				threshold: 0,
				rootMargin: `0px 0px ${BOTTOM_THRESHOLD}px 0px`,
			}
		);
		intersectionObserver.observe(sentinel);
	}

	// ResizeObserver for content changes (new messages, expanding blocks)
	if (typeof ResizeObserver !== "undefined") {
		const target = node.firstElementChild ?? node;
		resizeObserver = new ResizeObserver(() => {
			// Don't auto-scroll if user has detached
			if (isDetached && !navigating.to) return;
			// Don't interrupt active user scrolling
			if (userScrolling) return;
			scrollToBottom();
		});
		resizeObserver.observe(target);
	}

	// Initial scroll if we have content
	if (dependency) {
		void updateScroll({ force: true });
	}

	return {
		update: updateScroll,
		destroy: () => {
			if (userScrollTimeout) clearTimeout(userScrollTimeout);
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
