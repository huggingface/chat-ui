<script lang="ts">
	import CarbonWand from "~icons/carbon/magic-wand-filled";

	export let classNames = "";
	export let generating = false;
	import EosIconsLoading from "~icons/eos-icons/loading";
</script>

<button
	type="button"
	on:click
	disabled={generating}
	class="btn flex h-8 rounded-lg border bg-white px-3 py-1 text-gray-500 shadow-sm transition-all {classNames}"
	class:hover:bg-gray-100={!generating}
>
	{#if generating}
		<EosIconsLoading class="mr-2 text-xs " />
		Generating
	{:else}
		<CarbonWand class="mr-2 text-xs " /> Generate
	{/if}
</button>
