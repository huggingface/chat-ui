<script lang="ts">
	import { webSearchParameters } from "$lib/stores/webSearchParameters";
	import CarbonInformation from "~icons/carbon/information";
</script>

<div
	class="flex h-9 rounded-xl border bg-white p-1.5 shadow-sm hover:shadow-none dark:border-gray-600 dark:bg-gray-700"
>
	<div class="my-auto h-6">
		<label class="relative inline-flex cursor-pointer items-center">
			<input
				type="checkbox"
				value=""
				class="peer sr-only"
				on:click={() => {
					webSearchParameters.update((value) => ({ ...value, useSearch: !value.useSearch }));
				}}
				checked={$webSearchParameters.useSearch}
			/>
			<div
				class="peer h-6 w-11 rounded-full 
			bg-gray-200 after:absolute after:left-[2px] 
			after:top-[2px] after:h-5 after:w-5 
			after:rounded-full after:border 
			after:border-gray-300 after:bg-white 
			after:transition-all 
			after:content-[''] 
			peer-checked:bg-blue-600 
			peer-checked:after:translate-x-full 
			peer-checked:after:border-white peer-focus:outline-none
			peer-focus:ring-4 peer-focus:ring-blue-300
			dark:border-gray-200 dark:bg-gray-600
			dark:peer-focus:ring-blue-800"
			/>
		</label>
	</div>
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
