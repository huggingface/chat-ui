<script lang="ts">
	import { fade } from "svelte/transition";
	import IconChevron from "./icons/IconChevron.svelte";
	import { onDestroy } from "svelte";

	export let scrollNode: HTMLElement;
	export { className as class };

	let visible: boolean = false;
	let className = "";

	$: if (scrollNode) {
		scrollNode.addEventListener("scroll", onScroll);
	}

	function onScroll() {
		visible =
			Math.ceil(scrollNode.scrollTop) + 200 < scrollNode.scrollHeight - scrollNode.clientHeight;
	}

	onDestroy(() => {
		if (!scrollNode) return;
		scrollNode.removeEventListener("scroll", onScroll);
	});
</script>

{#if visible}
	<button
		transition:fade={{ duration: 150 }}
		on:click={() => scrollNode.scrollTo({ top: scrollNode.scrollHeight, behavior: "smooth" })}
		class="btn absolute flex rounded-full border w-[41px] h-[41px] shadow-md dark:shadow-gray-950 bg-white dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 dark:border-gray-600 transition-all {className}"
		><IconChevron classNames="mt-[2px]" /></button
	>
{/if}
