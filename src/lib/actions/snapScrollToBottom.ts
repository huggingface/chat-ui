import { navigating } from "$app/state";
import { tick } from "svelte";

const detachedOffset = 10;

const waitForAnimationFrame = () =>
	typeof requestAnimationFrame === "function"
		? new Promise<void>((resolve) => {
				requestAnimationFrame(() => resolve());
			})
		: Promise.resolve();

/**
 * @param node element to snap scroll to bottom
 * @param dependency pass in a dependency to update scroll on changes.
 */
export const snapScrollToBottom = (node: HTMLElement, dependency: unknown) => {
	let prevScrollValue = node.scrollTop;
	let isDetached = false;
	let resizeObserver: ResizeObserver | undefined;

	const scrollToBottom = () => {
		node.scrollTo({ top: node.scrollHeight });
	};

	const distanceFromBottom = () => node.scrollHeight - node.scrollTop - node.clientHeight;

	async function updateScroll(_options: { force?: boolean } = {}) {
		const options = { force: false, ..._options };
		const { force } = options;

		if (!force && isDetached && !navigating.to) return;

		// wait for the next tick to ensure that the DOM is updated
		await tick();
		scrollToBottom();

		// ensure we settle after late layout shifts (e.g. markdown/image renders)
		if (typeof requestAnimationFrame === "function") {
			await waitForAnimationFrame();
			scrollToBottom();
			await waitForAnimationFrame();
			scrollToBottom();
		}
	}

	const handleScroll = () => {
		// if user scrolled up, we detach
		if (node.scrollTop < prevScrollValue) {
			isDetached = true;
		}

		const atBottom = distanceFromBottom() <= detachedOffset;
		if (atBottom) {
			const wasDetached = isDetached;
			isDetached = false;
			if (wasDetached) {
				void updateScroll({ force: true });
			}
		}

		prevScrollValue = node.scrollTop;
	};

	node.addEventListener("scroll", handleScroll);

	if (typeof ResizeObserver !== "undefined") {
		const target = node.firstElementChild ?? node;
		resizeObserver = new ResizeObserver(() => {
			if (isDetached && !navigating.to) return;
			scrollToBottom();
		});
		resizeObserver.observe(target);
	}

	if (dependency) {
		void updateScroll({ force: true });
	}

	return {
		update: updateScroll,
		destroy: () => {
			node.removeEventListener("scroll", handleScroll);
			resizeObserver?.disconnect();
		},
	};
};
