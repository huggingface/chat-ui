import { browser } from "$app/environment";
import type { WebHaptics } from "web-haptics";

let instance: WebHaptics | null = null;
let enabled = true;

/**
 * Lazily initializes the WebHaptics instance on first use.
 * Avoids importing at module level so SSR doesn't break.
 */
async function getInstance(): Promise<WebHaptics | null> {
	if (!browser) return null;
	if (instance) return instance;

	try {
		const { WebHaptics: WH } = await import("web-haptics");
		instance = new WH();
		return instance;
	} catch {
		return null;
	}
}

/** Call from the settings store to keep haptics in sync with user preference. */
export function setHapticsEnabled(value: boolean) {
	enabled = value;
}

/** Whether the device likely supports haptic feedback (touch screen present). */
export function supportsHaptics(): boolean {
	return browser && navigator.maxTouchPoints > 0;
}

// ── Semantic haptic actions ──────────────────────────────────────────

/** Light tap — for routine actions (send message, toggle, navigate). */
export async function tap() {
	if (!enabled) return;
	const h = await getInstance();
	await h?.trigger("light");
}

/** Success confirmation — double-tap pattern (copy, share, save). */
export async function confirm() {
	if (!enabled) return;
	const h = await getInstance();
	await h?.trigger("success");
}

/** Error / destructive warning — three rapid taps (delete, stop generation). */
export async function error() {
	if (!enabled) return;
	const h = await getInstance();
	await h?.trigger("error");
}

/** Selection change — subtle tap for pickers and selections. */
export async function selection() {
	if (!enabled) return;
	const h = await getInstance();
	await h?.trigger("selection");
}
