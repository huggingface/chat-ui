<script lang="ts">
	import { webSearchParameters } from "$lib/stores/webSearchParameters";
	import CarbonInformation from "~icons/carbon/information";
	import Switch from "./Switch.svelte";
	import { useTranslations } from "$lib/stores/translations";

	const toggle = () => ($webSearchParameters.useSearch = !$webSearchParameters.useSearch);
	const translations = useTranslations();
</script>

<div
	class="flex h-8 cursor-pointer select-none items-center gap-2 rounded-lg border bg-white p-1.5 shadow-sm hover:shadow-none dark:border-gray-800 dark:bg-gray-900"
	onclick={toggle}
	onkeydown={toggle}
	aria-checked={$webSearchParameters.useSearch}
	aria-label={$translations.t("web_search_toggle")}
	role="switch"
	tabindex="0"
>
	<Switch name="useSearch" bind:checked={$webSearchParameters.useSearch} />
	<label for="useSearch" class="whitespace-nowrap text-sm text-gray-800 dark:text-gray-200">
		{$translations.t("search_web")}
	</label>
	<div class="group relative w-max">
		<CarbonInformation class="text-xs text-gray-500" />
		<div
			class="pointer-events-none absolute -top-20 left-1/2 w-max -translate-x-1/2 rounded-md bg-gray-100 p-2 opacity-0 transition-opacity group-hover:opacity-100 dark:bg-gray-800"
		>
			<p class="max-w-sm text-sm text-gray-800 dark:text-gray-200">
				{$translations.t("web_search_description")}
			</p>
		</div>
	</div>
</div>
