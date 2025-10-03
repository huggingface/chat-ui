<script lang="ts">
	import { fade } from "svelte/transition";
	import IconChevron from "./icons/IconChevron.svelte";
	import { ScrollState } from "runed";

	interface Props {
		scrollNode: HTMLElement;
		class?: string;
	}

	let { scrollNode, class: className = "" }: Props = $props();

	const scrollState = new ScrollState({ element: () => scrollNode, offset: { bottom: 200 } });
	const visible = $derived(!scrollState.arrived.bottom);
</script>

{#if visible}
	<button
		transition:fade={{ duration: 150 }}
		onclick={() => scrollNode.scrollTo({ top: scrollNode.scrollHeight, behavior: "smooth" })}
		class="btn absolute flex h-[41px] w-[41px] rounded-full border bg-white shadow-md transition-all hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:shadow-gray-950 dark:hover:bg-gray-600 {className}"
		><IconChevron classNames="mt-[2px]" /></button
	>
{/if}
