/**
 * Emulates ChatWindow's reactive template bindings for the scroll system, so
 * the ChatScroll tests exercise the same DOM contract the app renders:
 *
 *   - the message column's `padding-bottom` is the composer clearance
 *     (`chat.bottomClearancePx`);
 *   - the LAST turn group carries the reservation (`min-height:
 *     chat.anchorMinHeightPx`) exactly when its key is the anchored turn's.
 *
 * Lives in its own `.svelte.ts` module because the test files themselves are
 * not rune-compiled (only the `*.svelte.ts` suffix is). `flushSync` gives the
 * tests the app's same-flush semantics: state changes and their DOM bindings
 * land in the same task, before the next animation frame.
 */

import { flushSync } from "svelte";
import type { ChatScroll } from "../chatScroll.svelte";

export interface TurnDom {
	groups: { key: string; el: HTMLElement }[];
	addGroup(key: string, el: HTMLElement): void;
	removeLastGroup(): HTMLElement | undefined;
	/** Apply pending reactive bindings synchronously (the app's template patch). */
	flush(): void;
	dispose(): void;
}

export function createTurnDom(chat: ChatScroll, content: HTMLElement): TurnDom {
	const groups: { key: string; el: HTMLElement }[] = $state([]);

	const dispose = $effect.root(() => {
		$effect(() => {
			content.style.paddingBottom = `${chat.bottomClearancePx}px`;
		});
		$effect(() => {
			const anchoredIndex = chat.anchoredTurnIndex;
			const minHeight = chat.anchorMinHeightPx;
			for (let i = 0; i < groups.length; i++) {
				groups[i].el.style.minHeight = i === anchoredIndex ? `${minHeight}px` : "";
			}
		});
	});
	flushSync();

	return {
		groups,
		addGroup(key, el) {
			groups.push({ key, el });
		},
		removeLastGroup() {
			return groups.pop()?.el;
		},
		flush() {
			flushSync();
		},
		dispose,
	};
}
