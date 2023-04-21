import { navigating } from "$app/stores";
import { get } from "svelte/store";

/**
 * @param node element to snap scroll to bottom
 * @param dependency pass in a dependency to update scroll on changes.
 */
export const snapScrollToBottom = (node: HTMLElement, dependency: any) => {
	let prevScrollValue = node.scrollTop;
	let isDetached = false;

	const handleScroll = () => {
		// if user scrolled up, we detach
		if (node.scrollTop < prevScrollValue) {
			isDetached = true;
		}

		// if user scrolled back to bottom, we reattach
		if (node.scrollTop === node.scrollHeight - node.clientHeight) {
			isDetached = false;
		}

		prevScrollValue = node.scrollTop;
	};

	const updateScroll = (_options: { force?: boolean } = {}) => {
		const defaultOptions = { force: false };
		const options = { ...defaultOptions, ..._options };
		const { force } = options;

		if (!force && isDetached && !get(navigating)) return;

		node.scroll({
			top: node.scrollHeight,
		});
	};

	node.addEventListener("scroll", handleScroll);

	updateScroll({ force: true });

	return {
		update: updateScroll,
		destroy: () => {
			node.removeEventListener("scroll", handleScroll);
		},
	};
};
