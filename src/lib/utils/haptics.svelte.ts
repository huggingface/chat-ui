import { browser } from "$app/environment";
import { getContext, setContext, onDestroy } from "svelte";
import type { Readable } from "svelte/store";
import { get } from "svelte/store";

const HAPTICS_CTX_KEY = "haptics";

export interface HapticsContext {
	trigger: (preset?: string) => void;
	isSupported: boolean;
}

const NOOP_CTX: HapticsContext = { trigger: () => {}, isSupported: false };

/**
 * Initialize the haptics context. Call once in the root +layout.svelte.
 * The settings store is read on every trigger to respect live toggling.
 */
export function createHapticsContext(
	settingsStore: Readable<{ hapticFeedback: boolean }>
): HapticsContext {
	if (!browser) {
		setContext(HAPTICS_CTX_KEY, NOOP_CTX);
		return NOOP_CTX;
	}

	const isSupported = typeof navigator !== "undefined" && "vibrate" in navigator;

	let instance: {
		trigger: (input?: string | number | number[], options?: { intensity?: number }) => void;
		destroy: () => void;
	} | null = null;

	// Dynamic import to avoid SSR issues with navigator references
	if (isSupported) {
		import("web-haptics/svelte")
			.then(({ createWebHaptics }) => {
				instance = createWebHaptics();
			})
			.catch(() => {
				// Graceful degradation
			});
	}

	function trigger(preset: string = "selection") {
		if (!instance || !get(settingsStore).hapticFeedback) return;
		try {
			instance.trigger(preset);
		} catch {
			// Never break the app for haptics
		}
	}

	const ctx: HapticsContext = { trigger, isSupported };
	setContext(HAPTICS_CTX_KEY, ctx);

	onDestroy(() => {
		instance?.destroy();
		instance = null;
	});

	return ctx;
}

/**
 * Get the haptics context from any descendant component.
 * Returns a safe no-op if context is missing (SSR, tests).
 */
export function useHaptics(): HapticsContext {
	try {
		return getContext<HapticsContext>(HAPTICS_CTX_KEY) ?? NOOP_CTX;
	} catch {
		return NOOP_CTX;
	}
}
