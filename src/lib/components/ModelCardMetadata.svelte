<script lang="ts">
	import CarbonEarth from "~icons/carbon/earth";
	import CarbonArrowUpRight from "~icons/carbon/arrow-up-right";

	export let modelUrl = "";
	export let datasetUrl = "";
	export let websiteUrl = "";
	export let variant: "light" | "dark" = "light";
</script>

<div
	class="flex items-center gap-5 rounded-xl bg-gray-100 px-3 py-2 text-sm 
	{variant === 'dark'
		? 'text-gray-600 dark:bg-gray-800 dark:text-gray-300'
		: 'text-gray-800 dark:bg-gray-100 dark:text-gray-600'}"
>
	{#if modelUrl}
		<a href={modelUrl} target="_blank" rel="noreferrer" class="flex items-center hover:underline"
			><CarbonArrowUpRight class="mr-1.5 shrink-0 text-xs text-gray-400" />
			Model
			<div class="max-sm:hidden">&nbsp;page</div></a
		>
	{/if}
	{#if datasetUrl}
		<a href={datasetUrl} target="_blank" rel="noreferrer" class="flex items-center hover:underline"
			><CarbonArrowUpRight class="mr-1.5 shrink-0 text-xs text-gray-400" />
			Dataset
			<div class="max-sm:hidden">&nbsp;page</div></a
		>
	{/if}
	{#if websiteUrl}
		<a
			href={websiteUrl}
			target="_blank"
			class="ml-auto flex items-center hover:underline"
			rel="noreferrer"
			><CarbonEarth class="mr-1.5 shrink-0 text-xs text-gray-400" />
			Open Assistant Website</a
		>
	{/if}
</div>
