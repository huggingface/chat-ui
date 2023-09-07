import { navigating } from "$app/stores";
import { tick } from "svelte";
import { get } from "svelte/store";

const detachedOffset = 10;

/**
 * @param node element to snap scroll to bottom
 * @param dependency pass in a dependency to update scroll on changes.
 */
export const snapScrollToBottom = (node: HTMLElement, dependency: unknown) => {
	let prevScrollValue = node.scrollTop;
	let isDetached = false;

	const handleScroll = () => {
		// if user scrolled up, we detach
		if (node.scrollTop < prevScrollValue) {
			isDetached = true;
		}

		// if user scrolled back to within 10px of bottom, we reattach
		if (node.scrollTop - (node.scrollHeight - node.clientHeight) >= -detachedOffset) {
			isDetached = false;
		}

		prevScrollValue = node.scrollTop;
	};

	const updateScroll = async (_options: { force?: boolean } = {}) => {
		const defaultOptions = { force: false };
		const options = { ...defaultOptions, ..._options };
		const { force } = options;

		if (!force && isDetached && !get(navigating)) return;

		// wait for next tick to ensure that the DOM is updated
		await tick();

		node.scrollTo({ top: node.scrollHeight });
	};

	node.addEventListener("scroll", handleScroll);

	if (dependency) {
		updateScroll({ force: true });
	}

	return {
		update: updateScroll,
		destroy: () => {
			node.removeEventListener("scroll", handleScroll);
		},
	};
};
