<script lang="ts">
	import { navigating } from "$app/stores";
	import { fade } from "svelte/transition";
	import { onDestroy } from "svelte";
	import IconChevron from "./icons/IconChevron.svelte";

	export let scrollNode: HTMLElement;
	export { className as class };

	let visible: boolean = false;
	let className = "";

	$: if (scrollNode) {
		scrollNode.addEventListener("scroll", handleScroll);
	}

	$: if ($navigating) {
		updateVisibility();
	}

	function handleScroll() {
		updateVisibility();
	}

	function updateVisibility() {
		if (!scrollNode) return;
		visible =
			Math.ceil(scrollNode.scrollTop) + 200 < scrollNode.scrollHeight - scrollNode.clientHeight;
	}

	onDestroy(() => {
		if (!scrollNode) return;
		scrollNode.removeEventListener("scroll", handleScroll);
	});
</script>

{#if visible}
	<button
		transition:fade={{ duration: 150 }}
		on:click={() => scrollNode.scrollTo({ top: scrollNode.scrollHeight, behavior: "smooth" })}
		class="btn absolute flex h-[41px] w-[41px] rounded-full border bg-white shadow-md transition-all hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:shadow-gray-950 dark:hover:bg-gray-600 {className}"
		><IconChevron classNames="mt-[2px]" /></button
	>
{/if}
