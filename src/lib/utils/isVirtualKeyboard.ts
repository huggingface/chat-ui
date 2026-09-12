import { browser } from "$app/environment";

/**
 * Pure heuristic deciding whether a device relies on an on-screen (virtual)
 * keyboard, based on the relevant device signals. Extracted from
 * {@link isVirtualKeyboard} so it can be unit-tested without browser globals.
 *
 * Devices that pop up an on-screen keyboard (phones, tablets) expose a coarse
 * primary pointer. Touch-screen laptops report touch capability too, but their
 * primary pointer is a mouse/trackpad (fine), so they must NOT be treated as
 * virtual-keyboard devices — otherwise Enter-to-send and related behaviour
 * break on those machines.
 */
export function detectVirtualKeyboard(opts: {
	hasCoarsePrimaryPointer: boolean;
	userAgent: string;
}): boolean {
	if (opts.hasCoarsePrimaryPointer) return true;

	// Fallback to user agent string check for browsers without pointer media queries.
	return /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(
		opts.userAgent.toLowerCase()
	);
}

export function isVirtualKeyboard(): boolean {
	if (!browser) return false;

	return detectVirtualKeyboard({
		hasCoarsePrimaryPointer: window.matchMedia?.("(pointer: coarse)").matches ?? false,
		userAgent: navigator.userAgent,
	});
}
