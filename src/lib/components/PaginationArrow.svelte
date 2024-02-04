<script lang="ts">
	import CarbonCaretLeft from "~icons/carbon/caret-left";
	import CarbonCaretRight from "~icons/carbon/caret-right";

	export let direction: "next" | "previous";
	export let onClick: (dir: "next" | "previous") => void = () => {};
	export let isDisabled = false;
</script>

<button
	class="flex items-center rounded-lg px-2.5 py-1 hover:bg-gray-50 dark:hover:bg-gray-800"
	class:pointer-events-none={isDisabled}
	class:opacity-50={isDisabled}
	on:click|preventDefault={() => onClick(direction)}
>
	{#if direction === "previous"}
		<CarbonCaretLeft classNames="mr-1.5" />
		Previous
	{:else}
		Next
		<CarbonCaretRight classNames="ml-1.5" />
	{/if}
</button>
