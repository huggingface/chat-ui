<script lang="ts">
	import { jsonSummary, unpackJson } from "$lib/utils/review/json";
	import JsonView from "./JsonView.svelte";

	interface Props {
		value: unknown;
		clamp?: boolean;
	}

	let { value, clamp = false }: Props = $props();

	let shown = $derived(unpackJson(value));
</script>

{#if clamp}
	<span class="block truncate font-mono text-xs text-gray-500 dark:text-gray-400">
		{jsonSummary(shown)}
	</span>
{:else}
	<div
		class="min-w-0 rounded-lg bg-gray-50 px-3 py-2 text-[14px] leading-normal text-gray-700 dark:bg-gray-800 dark:text-gray-200"
		data-json-field
	>
		<JsonView value={shown} />
	</div>
{/if}
