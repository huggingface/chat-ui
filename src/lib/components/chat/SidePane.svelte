<script lang="ts">
	import type { Snippet } from "svelte";

	import { sidePane, SIDE_PANE_DEFAULT_FRACTION } from "$lib/stores/sidePane.svelte";
	import { useIsDesktop } from "$lib/utils/isDesktop.svelte";

	interface Props {
		/** Accessible name for the pane, e.g. "Artifact panel". */
		label: string;
		/**
		 * Suppresses Escape-to-close while the view has something more urgent bound
		 * to it (a modal of its own, an in-flight generation).
		 */
		escapeDisabled?: boolean;
		/**
		 * The view's own header/body/footer. Receives `resizing` so it can make
		 * iframes pointer-events-none mid-drag — otherwise the frame swallows the
		 * pointer and the drag dies as soon as it crosses into the content.
		 */
		children: Snippet<[boolean]>;
	}

	let { label, escapeDisabled = false, children }: Props = $props();

	/**
	 * The shared frame every side-pane view sits in: a resizable column beside the
	 * chat on desktop, a fullscreen overlay on mobile. Views gate their own
	 * mounting on `sidePane.view`, so only one of them is ever rendered here.
	 */
	const isDesktop = useIsDesktop();

	let resizing = $state(false);
	let asideEl: HTMLElement | undefined = $state();

	function onResizeStart(e: PointerEvent) {
		resizing = true;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function onResizeMove(e: PointerEvent) {
		if (!resizing) return;
		// Clamp against the live chat/pane split (each pane keeps >= 20%) so the
		// drag tracks the pointer 1:1 with no dead zone at the bounds.
		const total = asideEl?.parentElement?.clientWidth ?? window.innerWidth;
		const raw = window.innerWidth - e.clientX;
		sidePane.setWidth(Math.min(Math.max(raw, Math.max(total * 0.2, 300)), total * 0.8));
	}
	function onResizeEnd() {
		resizing = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		// An Escape already consumed by a modal (external-link confirm, fullscreen
		// preview) must not also close the pane
		if (e.defaultPrevented) return;
		if (e.key === "Escape" && sidePane.open && !escapeDisabled) {
			e.preventDefault();
			sidePane.close();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- One persistent container reshaped by breakpoint classes, NOT two
     alternate branches: a branch swap would remount the children — and any
     live document in them (artifact iframe, Trackio dashboard, PDF) — so
     crossing the 768px breakpoint (e.g. rotating a tablet) would reload them
     and lose their state. Desktop: resizable side column. Mobile: viewport
     overlay with dialog semantics. -->
<aside
	bind:this={asideEl}
	role={isDesktop.current ? undefined : "dialog"}
	class="pointer-events-auto flex flex-col bg-white dark:bg-gray-900 {isDesktop.current
		? 'relative z-10 h-full flex-none overflow-hidden border-l border-gray-100 dark:border-gray-800'
		: 'fixed inset-0 z-30'}"
	style={isDesktop.current
		? `width: ${
				sidePane.widthPx !== null ? `${sidePane.widthPx}px` : SIDE_PANE_DEFAULT_FRACTION
			}; min-width: max(20%, 300px); max-width: 80%;`
		: ""}
	aria-label={label}
>
	{#if isDesktop.current}
		<!-- resize handle (drag to resize, double-click to reset) -->
		<div
			role="separator"
			aria-orientation="vertical"
			class="absolute inset-y-0 left-0 z-20 w-1.5 cursor-col-resize transition-colors hover:bg-blue-400/40 {resizing
				? 'bg-blue-400/60'
				: ''}"
			onpointerdown={onResizeStart}
			onpointermove={onResizeMove}
			onpointerup={onResizeEnd}
			onpointercancel={onResizeEnd}
			ondblclick={() => sidePane.resetWidth()}
		></div>
	{/if}
	{@render children(isDesktop.current && resizing)}
</aside>
