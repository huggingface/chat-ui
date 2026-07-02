<script lang="ts">
	import { navigating } from "$app/state";

	// Conversation switches block on the conversation fetch before the page
	// swaps, so give the user immediate feedback. The delay keeps fast
	// navigations (warm cache, quick network) from flashing the bar.
	const SHOW_DELAY_MS = 150;

	let visible = $state(false);

	$effect(() => {
		if (navigating.to?.route.id === "/conversation/[id]") {
			const timer = setTimeout(() => (visible = true), SHOW_DELAY_MS);
			return () => {
				clearTimeout(timer);
				visible = false;
			};
		}
		visible = false;
	});
</script>

{#if visible}
	<div
		class="fixed inset-x-0 top-0 z-50 h-[3px] overflow-hidden"
		role="progressbar"
		aria-label="Loading conversation"
	>
		<div class="loading-bar h-full w-2/5 rounded-r-full bg-black/70 dark:bg-white/60"></div>
	</div>
{/if}

<style>
	.loading-bar {
		animation: slide 1.2s cubic-bezier(0.4, 0, 0.2, 1) infinite;
	}
	@keyframes slide {
		0% {
			transform: translateX(-100%);
		}
		100% {
			transform: translateX(350%);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.loading-bar {
			animation: none;
			width: 100%;
			opacity: 0.4;
		}
	}
</style>
