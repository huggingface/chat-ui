<script lang="ts">
	import { webSearchParameters } from "$lib/stores/webSearchParameters";
	import CarbonInformation from "~icons/carbon/information";
	import Switch from "./Switch.svelte";

	export let tools: {
		webSearch: boolean;
		textToImage: boolean;
	};

	const toggleWebSearch = () => ($webSearchParameters.useSearch = !$webSearchParameters.useSearch);
	const toggleSDXL = () => ($webSearchParameters.useSDXL = !$webSearchParameters.useSDXL);
</script>

<div
	class="flex flex-col flex-nowrap  rounded-xl border bg-white p-1.5 shadow-sm hover:shadow-none dark:border-gray-800 dark:bg-gray-900"
>
	{#if tools.webSearch}
		<div
			class="flex h-9 w-full cursor-pointer select-none items-center gap-2"
			on:click={toggleWebSearch}
			on:keypress={toggleWebSearch}
		>
			<Switch name="useSearch" bind:checked={$webSearchParameters.useSearch} on:click on:keypress />
			<div class="whitespace-nowrap text-sm text-gray-800 dark:text-gray-200">Web Search</div>
			<div class="group relative mr-auto w-max">
				<CarbonInformation class="text-xs text-gray-500" />
				<div
					class="pointer-events-none absolute -top-20 left-1/2 w-max -translate-x-1/2 rounded-md bg-gray-100 p-2 opacity-0 transition-opacity group-hover:opacity-100 dark:bg-gray-800"
				>
					<p class="max-w-sm text-sm text-gray-800 dark:text-gray-200">
						When enabled, the request will be completed with relevant context fetched from the web.
					</p>
				</div>
			</div>
		</div>
	{/if}
	{#if tools.textToImage}
		<div
			class="flex h-9 cursor-pointer select-none items-center gap-2"
			on:click={toggleSDXL}
			on:keypress={toggleSDXL}
		>
			<Switch name="useSearch" bind:checked={$webSearchParameters.useSDXL} on:click on:keypress />
			<div class="whitespace-nowrap text-sm text-gray-800 dark:text-gray-200">SDXL Images</div>
			<div class="group relative w-max">
				<CarbonInformation class="text-xs text-gray-500" />
				<div
					class="pointer-events-none absolute -top-20 left-1/2 w-max -translate-x-1/2 rounded-md bg-gray-100 p-2 opacity-0 transition-opacity group-hover:opacity-100 dark:bg-gray-800"
				>
					<p class="max-w-sm text-sm text-gray-800 dark:text-gray-200">
						When enabled, the model will try to generate images to go along with the answers.
					</p>
				</div>
			</div>
		</div>
	{/if}
</div>
