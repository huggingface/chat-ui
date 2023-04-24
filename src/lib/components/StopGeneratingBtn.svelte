<script lang="ts">
	import { fade } from "svelte/transition";
	import { createEventDispatcher } from "svelte";

	import CarbonStop from "~icons/carbon/stop";

	export let visible: boolean = false;
	export let className = "";

	const dispatch = createEventDispatcher<{ stop: string }>();
</script>

{#if visible}
	<button
		transition:fade={{ duration: 150 }}
		type="button"
		class="absolute btn flex rounded-full border py-1 px-3 shadow-md dark:shadow-gray-950 bg-white dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 dark:border-gray-600 transition-all {className}"
		on:click={() => dispatch("stop")}
	>
		<CarbonStop class="mr-1 -ml-1 text-lg" /> Stop generating
	</button>
{/if}
