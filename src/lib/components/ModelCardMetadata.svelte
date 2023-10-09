<script lang="ts">
	import CarbonEarth from "~icons/carbon/earth";
	import CarbonArrowUpRight from "~icons/carbon/arrow-up-right";
	import type { Model } from "$lib/types/Model";

	export let model: Pick<Model, "name" | "datasetName" | "websiteUrl" | "modelUrl" | "datasetUrl">;

	export let variant: "light" | "dark" = "light";
</script>

<div
	class="flex items-center gap-5 rounded-xl bg-gray-100 px-3 py-2 text-xs sm:text-sm
	{variant === 'dark'
		? 'text-gray-600 dark:bg-gray-800 dark:text-gray-300'
		: 'text-gray-800 dark:bg-gray-100 dark:text-gray-600'}"
>
	<a
		href={model.modelUrl || "https://huggingface.co/" + model.name}
		target="_blank"
		rel="noreferrer"
		class="flex items-center hover:underline"
		><CarbonArrowUpRight class="mr-1.5 shrink-0 text-xs text-gray-400" />
		Model
		<div class="max-sm:hidden">&nbsp;page</div></a
	>
	{#if model.datasetName || model.datasetUrl}
		<a
			href={model.datasetUrl || "https://huggingface.co/datasets/" + model.datasetName}
			target="_blank"
			rel="noreferrer"
			class="flex items-center hover:underline"
			><CarbonArrowUpRight class="mr-1.5 shrink-0 text-xs text-gray-400" />
			Dataset
			<div class="max-sm:hidden">&nbsp;page</div></a
		>
	{/if}
	{#if model.websiteUrl}
		<a
			href={model.websiteUrl}
			target="_blank"
			class="ml-auto flex items-center hover:underline"
			rel="noreferrer"
		>
			<CarbonEarth class="mr-1.5 shrink-0 text-xs text-gray-400" />
			Website
		</a>
	{/if}
</div>
