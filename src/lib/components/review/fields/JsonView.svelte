<script lang="ts">
	import { isContainer, isFlatObject, jsonSummary } from "$lib/utils/review/json";
	import JsonView from "./JsonView.svelte";

	interface Props {
		value: unknown;
		/** nested containers below the first level start folded */
		depth?: number;
	}

	let { value, depth = 0 }: Props = $props();

	/** a string this long folds to its start, the rest is a click away */
	const LONG_CHARS = 500;
	/** a container this big shows its first entries, the rest is a click away */
	const SHOWN_ENTRIES = 100;

	let expanded = $state(false);
	let showAllEntries = $state(false);

	let entries = $derived(
		isContainer(value)
			? Array.isArray(value)
				? value.map((item, index) => [String(index), item] as const)
				: Object.entries(value)
			: []
	);
	let shownEntries = $derived(showAllEntries ? entries : entries.slice(0, SHOWN_ENTRIES));
	let text = $derived(typeof value === "string" ? value : "");
	let long = $derived(text.length > LONG_CHARS);
</script>

{#snippet more(label: string, onclick: () => void)}
	<button
		type="button"
		class="ml-1 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
		{onclick}
	>
		{label}
	</button>
{/snippet}

{#if typeof value === "string"}
	<span class="break-words whitespace-pre-wrap" data-json-string
		>{long && !expanded ? `${text.slice(0, LONG_CHARS)}…` : text}</span
	>{#if long}{@render more(expanded ? "Show less" : "Show more", () => (expanded = !expanded))}{/if}
{:else if !isContainer(value)}
	<span class="font-mono text-[13px] text-blue-700 dark:text-blue-300">{String(value)}</span>
{:else if entries.length === 0}
	<span class="font-mono text-[13px] text-gray-500">{Array.isArray(value) ? "[]" : "{}"}</span>
{:else if isFlatObject(value)}
	<dl
		class="m-0 grid grid-cols-[minmax(0,max-content)_minmax(0,1fr)] gap-x-3 gap-y-1 whitespace-normal"
		data-json-flat
	>
		{#each entries as [key, item] (key)}
			<dt class="pt-px font-mono text-xs text-gray-500 dark:text-gray-400">{key}</dt>
			<dd class="m-0 min-w-0"><JsonView value={item} depth={depth + 1} /></dd>
		{/each}
	</dl>
{:else}
	<ul
		class={[
			"m-0 flex list-none flex-col gap-1 p-0 whitespace-normal",
			depth > 0 && "border-l border-gray-200 pl-3 dark:border-gray-700",
		]}
		data-json-tree
	>
		{#each shownEntries as [key, item] (key)}
			<li class="min-w-0">
				{#if isContainer(item) && !isFlatObject(item)}
					<details open={depth === 0 && entries.length <= 1}>
						<summary
							class="cursor-pointer font-mono text-xs text-gray-500 select-none hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
						>
							{key} <span class="opacity-70">· {jsonSummary(item)}</span>
						</summary>
						<div class="mt-1"><JsonView value={item} depth={depth + 1} /></div>
					</details>
				{:else}
					<div class="flex min-w-0 gap-2">
						<span class="flex-none pt-px font-mono text-xs text-gray-500 dark:text-gray-400"
							>{key}</span
						>
						<div class="min-w-0 flex-1"><JsonView value={item} depth={depth + 1} /></div>
					</div>
				{/if}
			</li>
		{/each}
		{#if entries.length > shownEntries.length}
			<li>
				{@render more(
					`Show ${entries.length - shownEntries.length} more`,
					() => (showAllEntries = true)
				)}
			</li>
		{/if}
	</ul>
{/if}
