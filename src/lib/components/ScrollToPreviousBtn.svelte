<script lang="ts">
	import { fade } from "svelte/transition";
	import IconChevron from "./icons/IconChevron.svelte";

	interface Props {
		visible: boolean;
		onclick: () => void;
		class?: string;
	}

	let { visible, onclick, class: className = "" }: Props = $props();
</script>

{#if visible}
	<button
		transition:fade={{ duration: 150 }}
		{onclick}
		aria-label="Scroll to previous message"
		class="absolute btn flex h-[41px] w-[41px] rounded-full border bg-white shadow-md transition-all hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:shadow-gray-950 dark:hover:bg-gray-600 {className}"
	>
		<IconChevron classNames="rotate-180 mt-[2px]" />
	</button>
{/if}
