<script lang="ts">
	import { createEventDispatcher, onDestroy, onMount } from "svelte";
	import { cubicOut } from "svelte/easing";
	import { fade, fly } from "svelte/transition";
	import Portal from "./Portal.svelte";
	import { browser } from "$app/environment";

	interface Props {
		width?: string;
		children?: import("svelte").Snippet;
	}

	let { width = "max-w-sm", children }: Props = $props();

	let backdropEl: HTMLDivElement | undefined = $state();
	let modalEl: HTMLDivElement | undefined = $state();

	const dispatch = createEventDispatcher<{ close: void }>();

	function handleKeydown(event: KeyboardEvent) {
		// close on ESC
		if (event.key === "Escape") {
			event.preventDefault();
			dispatch("close");
		}
	}

	function handleBackdropClick(event: MouseEvent) {
		if (window?.getSelection()?.toString()) {
			return;
		}
		if (event.target === backdropEl) {
			dispatch("close");
		}
	}

	onMount(() => {
		document.getElementById("app")?.setAttribute("inert", "true");
		modalEl?.focus();
	});

	onDestroy(() => {
		if (!browser) return;
		document.getElementById("app")?.removeAttribute("inert");
	});
</script>

<Portal>
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		role="presentation"
		tabindex="-1"
		bind:this={backdropEl}
		onclick={(e) => {
			e.stopPropagation();
			handleBackdropClick(e);
		}}
		transition:fade|local={{ easing: cubicOut, duration: 300 }}
		class="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-8 backdrop-blur-sm dark:bg-black/50"
	>
		<div
			role="dialog"
			tabindex="-1"
			bind:this={modalEl}
			onkeydown={handleKeydown}
			in:fly={{ y: 100 }}
			class={[
				"max-h-[90dvh] overflow-y-auto overflow-x-hidden rounded-2xl bg-white shadow-2xl outline-none sm:-mt-10",
				width,
			]}
		>
			{@render children?.()}
		</div>
	</div>
</Portal>
