import { navigating } from "$app/state";
import { tick } from "svelte";

const detachedOffset = 10;

const waitForAnimationFrame = () =>
	typeof requestAnimationFrame === "function"
		? new Promise<void>((resolve) => {
				requestAnimationFrame(() => resolve());
			})
		: Promise.resolve();

interface SnapScrollConfig {
	dependency: unknown;
	skipInitialScroll?: boolean;
}

/**
 * @param node element to snap scroll to bottom
 * @param config configuration object with dependency and optional skipInitialScroll flag
 */
export const snapScrollToBottom = (node: HTMLElement, config: SnapScrollConfig | unknown) => {
	// Support both old API (just dependency) and new API (config object)
	const isConfigObject = typeof config === "object" && config !== null && "dependency" in config;
	const dependency = isConfigObject ? (config as SnapScrollConfig).dependency : config;
	const skipInitialScroll = isConfigObject
		? ((config as SnapScrollConfig).skipInitialScroll ?? false)
		: false;

	let prevScrollValue = node.scrollTop;
	let isDetached = false;
	let resizeObserver: ResizeObserver | undefined;
	let isInitialMount = true;

	const scrollToBottom = () => {
		node.scrollTo({ top: node.scrollHeight });
	};

	const distanceFromBottom = () => node.scrollHeight - node.scrollTop - node.clientHeight;

	async function updateScroll(_options: { force?: boolean } = {}) {
		const options = { force: false, ..._options };
		const { force } = options;

		// Skip initial scroll if configured to do so
		if (isInitialMount && skipInitialScroll) {
			isInitialMount = false;
			return;
		}

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

		isInitialMount = false;
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
