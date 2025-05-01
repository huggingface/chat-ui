<script lang="ts">
	/* ------------------------------------------------------------
	   imports
	------------------------------------------------------------ */
	import { pageSettings } from "$lib/stores/settings";
	import { afterUpdate } from "svelte";
	import CarbonCheckmark from "~icons/carbon/checkmark";
	import CarbonInformation from "~icons/carbon/information";
	import type { WebSearchProvider } from "$lib/types/WebSearch";

	/* ------------------------------------------------------------
	   props (from +layout.server.ts)
	------------------------------------------------------------ */
	export let data: {
		websearchProviders: WebSearchProvider[];
	};

	/* ------------------------------------------------------------
	   local helpers
	------------------------------------------------------------ */
	const providerLabels: Record<WebSearchProvider, string> = {
		serper: "Serper (Google proxy)",
		google: "Google (via Serper)",
		bing: "Bing",
		duckduckgo: "DuckDuckGo (SearxNG)",
	};

	let savedFlash = false;

	// flash “Saved” check icons
	afterUpdate(() => {
		if ($pageSettings.recentlySaved && !savedFlash) {
			savedFlash = true;
			setTimeout(() => (savedFlash = false), 2000);
		}
	});
</script>

<!-- ──────────────────────────────────────────────── -->
<!--  Header                                         -->
<!-- ──────────────────────────────────────────────── -->
<div class="flex items-center gap-3 pb-6">
	<h1 class="text-2xl font-bold">Search Engine</h1>

	{#if savedFlash}
		<CarbonCheckmark class="h-5 w-5 text-green-600" />
	{/if}
</div>

<p class="mb-6 text-sm text-gray-600 flex items-start gap-2">
	<CarbonInformation class="mt-0.5 shrink-0 text-gray-500" />
	Choosing a provider changes which external search API HuggingChat calls
	when the <em>Web Search</em> tool is triggered.
</p>

<!-- ──────────────────────────────────────────────── -->
<!--  Provider list (radio style)                    -->
<!-- ──────────────────────────────────────────────── -->
<div class="space-y-4">
	{#each data.websearchProviders as provider}
		<label
			class="flex cursor-pointer items-center rounded-lg border border-gray-300 p-4 hover:bg-gray-50"
		>
			<input
				type="radio"
				class="mr-4 h-4 w-4 accent-black"
				name="search-provider"
				bind:group={$pageSettings.preferredSearchEngine}
				value={provider}
			/>
			<span class="mr-auto">{providerLabels[provider] ?? provider}</span>

			{#if provider === $pageSettings.preferredSearchEngine}
				<span
					class="rounded-md bg-black px-2 py-0.5 text-xs font-semibold leading-none text-white"
					>Selected</span
				>
			{/if}
		</label>
	{/each}
</div>
