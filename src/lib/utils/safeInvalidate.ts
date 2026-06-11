import { invalidate } from "$app/navigation";
import { navigating } from "$app/state";

/**
 * Run `invalidate()` without racing an in-flight navigation.
 *
 * Calling invalidate() while the router is mid-navigation cancels that
 * navigation: the invalidation overwrites the router's navigation token, so
 * the in-flight load is discarded and the user's click or goto() is silently
 * dropped (the goto() promise can even resolve without navigating). This
 * bites whenever a background refresh (post-stream sync, generation polling,
 * debounced settings saves) races a navigation, e.g. clicking "New Chat"
 * while a response is streaming.
 *
 * Instead of firing immediately, wait for any in-flight navigation to settle
 * first, then run the invalidation on the destination page.
 *
 * Note: the router exposes a navigation a tick after it starts, so a
 * navigation beginning in the same microtask burst as this call can still be
 * cancelled. None of our call sites fire in that window; truly
 * navigation-triggered refreshes must be skipped at the call site instead
 * (see the writeMessage finally block).
 */
export async function safeInvalidate(resource: string | URL): Promise<void> {
	while (navigating.to) {
		try {
			await navigating.complete;
		} catch {
			// navigation was superseded or failed; re-check and continue
		}
	}
	return invalidate(resource);
}
