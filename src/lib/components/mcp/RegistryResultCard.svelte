<script lang="ts">
	import type { MCPRegistryEntry } from "$lib/types/Tool";
	import IconAdd from "~icons/carbon/add";
	import IconCheckmark from "~icons/carbon/checkmark";
	import IconGlobe from "~icons/carbon/globe";

	interface Props {
		entry: MCPRegistryEntry;
		alreadyAdded: boolean;
		onadd: (entry: MCPRegistryEntry) => void;
	}

	let { entry, alreadyAdded, onadd }: Props = $props();
</script>

<div
	class="flex items-start gap-2 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800"
>
	<!-- Icon -->
	{#if entry.icons?.[0]?.src}
		<img
			src={entry.icons[0].src}
			alt={entry.name}
			class="mt-0.5 size-8 shrink-0 rounded object-contain"
			loading="lazy"
		/>
	{:else}
		<div
			class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded bg-gray-100 dark:bg-gray-700"
		>
			<IconGlobe class="size-4 text-blue-500" />
		</div>
	{/if}

	<div class="min-w-0 flex-1">
		<!-- Title -->
		<span class="text-sm font-medium text-gray-900 dark:text-gray-100">
			{entry.title ?? entry.name}
		</span>

		<!-- Description -->
		<p class="mt-0.5 line-clamp-2 text-xs text-gray-600 dark:text-gray-400">
			{entry.description}
		</p>
	</div>

	<!-- Action -->
	<div class="shrink-0">
		{#if alreadyAdded}
			<span
				class="flex items-center gap-1 rounded-lg bg-green-100 px-2.5 py-1.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400"
			>
				<IconCheckmark class="size-3" />
				Added
			</span>
		{:else}
			<button
				onclick={() => onadd(entry)}
				class="flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
			>
				<IconAdd class="size-3" />
				Add
			</button>
		{/if}
	</div>
</div>
