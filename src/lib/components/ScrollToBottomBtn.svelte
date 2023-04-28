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
		transition:fade|local={{ duration: 150 }}
		on:click={() => scrollNode.scrollTo({ top: scrollNode.scrollHeight, behavior: "smooth" })}
		class="btn absolute flex h-[41px] w-[41px] rounded-full border bg-white shadow-md transition-all hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:shadow-gray-950 dark:hover:bg-gray-600 {className}"
		><IconChevron classNames="mt-[2px]" /></button
	>
{/if}
