<script lang="ts">
	import { webSearchParameters } from "$lib/stores/webSearchParameters";
	import CarbonInformation from "~icons/carbon/information";
	import Switch from "./Switch.svelte";

	const toggle = () => ($webSearchParameters.useSearch = !$webSearchParameters.useSearch);
</script>

<div
	class="flex h-9 cursor-pointer rounded-xl border bg-white p-1.5 shadow-sm hover:shadow-none dark:border-gray-600 dark:bg-gray-700"
	on:click={toggle}
	on:keypress={toggle}
>
	<Switch name="useSearch" bind:checked={$webSearchParameters.useSearch} on:click on:keypress />
	<span class="my-auto ml-3 text-sm text-gray-800 dark:text-gray-200">Search web</span>
	<div class="group relative m-auto ml-2 w-max">
		<CarbonInformation />
		<span
			class="pointer-events-none absolute -top-16 w-max opacity-0 transition-opacity group-hover:opacity-100"
		>
			<p class="max-w-sm text-sm text-gray-800 dark:text-gray-200">
				When enabled, the model will try to complement its answer with information queried from the
				web.
			</p>
		</span>
	</div>
</div>
