export function isReducedMotion(window: Window) {
	const { matchMedia } = window;

	return matchMedia("(prefers-reduced-motion: reduce)").matches;
}
