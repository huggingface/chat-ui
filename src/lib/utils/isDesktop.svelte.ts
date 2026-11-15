import { onMount } from "svelte";

/** The breakpoint at which the side pane stops being a fullscreen overlay. */
export const DESKTOP_MEDIA_QUERY = "(min-width: 768px)";

/**
 * Reactive desktop-breakpoint flag, for the places that need it in script logic
 * rather than in markup (a Tailwind `md:` class covers the markup cases).
 *
 * Starts `true` so SSR and the first client render agree on the desktop layout;
 * the real value lands on mount. Must be called during component
 * initialisation, since it registers an `onMount` cleanup.
 */
export function useIsDesktop(): { readonly current: boolean } {
	let isDesktop = $state(true);
	onMount(() => {
		const mq = window.matchMedia(DESKTOP_MEDIA_QUERY);
		isDesktop = mq.matches;
		const onChange = () => (isDesktop = mq.matches);
		mq.addEventListener("change", onChange);
		return () => mq.removeEventListener("change", onChange);
	});
	return {
		get current() {
			return isDesktop;
		},
	};
}
