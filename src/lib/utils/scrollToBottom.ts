export const scrollToBottom = (node: any, _: any) => {
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

	const updateScroll = (_options: { withAnim?: boolean; force?: boolean } = {}) => {
		const defaultOptions = { withAnim: true, force: false };
		const options = { ...defaultOptions, ..._options };
		const { withAnim, force } = options;

		if (!force && isDetached) return;

		node.scroll({
			top: node.scrollHeight,
			behavior: withAnim ? 'smooth' : 'auto'
		});
	};

	node.addEventListener('scroll', handleScroll);

	updateScroll({ withAnim: false, force: true });

	return {
		update: updateScroll,
		destroy: () => {
			node.removeEventListener('scroll', handleScroll);
		}
	};
};
