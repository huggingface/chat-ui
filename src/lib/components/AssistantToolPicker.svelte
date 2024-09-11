<script lang="ts">
	import { base } from "$app/paths";
	import type { ToolLogoColor, ToolLogoIcon } from "$lib/types/Tool";
	import { debounce } from "$lib/utils/debounce";
	import { onMount } from "svelte";
	import ToolLogo from "./ToolLogo.svelte";

	import CarbonClose from "~icons/carbon/close";

	interface ToolSuggestion {
		_id: string;
		displayName: string;
		createdByName: string;
		color: ToolLogoColor;
		icon: ToolLogoIcon;
	}

	export let toolIds: string[] = [];

	let selectedValues: ToolSuggestion[] = [];

	onMount(async () => {
		selectedValues = await Promise.all(
			toolIds.map(async (id) => await fetch(`${base}/api/tools/${id}`).then((res) => res.json()))
		);

		await fetchSuggestions("");
	});

	let inputValue = "";
	let maxValues = 3;

	let suggestions: ToolSuggestion[] = [];

	async function fetchSuggestions(query: string) {
		suggestions = (await fetch(`${base}/api/tools/search?q=${query}`).then((res) =>
			res.json()
		)) satisfies ToolSuggestion[];
	}

	const debouncedFetch = debounce((query: string) => fetchSuggestions(query), 300);

	function addValue(value: ToolSuggestion) {
		if (selectedValues.length < maxValues && !selectedValues.includes(value)) {
			selectedValues = [...selectedValues, value];
			toolIds = [...toolIds, value._id];
			inputValue = "";
			suggestions = [];
		}
	}

	function removeValue(id: ToolSuggestion["_id"]) {
		selectedValues = selectedValues.filter((v) => v._id !== id);
		toolIds = selectedValues.map((value) => value._id);
	}
</script>

{#if selectedValues.length > 0}
	<div class="flex flex-wrap items-center justify-center gap-2">
		{#each selectedValues as value}
			<div
				class="flex items-center justify-center space-x-2 rounded border border-gray-300 bg-gray-200 px-2 py-1"
			>
				<ToolLogo color={value.color} icon={value.icon} size="sm" />
				<div class="flex flex-col items-center justify-center py-1">
					<a
						href={`${base}/tools/${value._id}`}
						target="_blank"
						class="line-clamp-1 truncate font-semibold text-blue-600 hover:underline"
						>{value.displayName}</a
					>
					{#if value.createdByName}
						<p class="text-center text-xs text-gray-500">
							Created by
							<a class="underline" href="{base}/tools?user={value.createdByName}" target="_blank"
								>{value.createdByName}</a
							>
						</p>
					{:else}
						<p class="text-center text-xs text-gray-500">Official HuggingChat tool</p>
					{/if}
				</div>
				<button
					on:click|stopPropagation|preventDefault={() => removeValue(value._id)}
					class="text-lg text-gray-600"
				>
					<CarbonClose />
				</button>
			</div>
		{/each}
	</div>
{/if}

{#if selectedValues.length < maxValues}
	<div class="group relative block">
		<input
			type="text"
			bind:value={inputValue}
			on:input={(ev) => {
				inputValue = ev.currentTarget.value;
				debouncedFetch(inputValue);
			}}
			disabled={selectedValues.length >= maxValues}
			class="w-full rounded border border-gray-200 bg-gray-100 px-3 py-2"
			class:opacity-50={selectedValues.length >= maxValues}
			class:bg-gray-100={selectedValues.length >= maxValues}
			placeholder="Type to search tools..."
		/>
		{#if suggestions.length > 0}
			<div
				class="invisible absolute z-10 mt-1 w-full rounded border border-gray-300 bg-white shadow-lg group-focus-within:visible"
			>
				{#each suggestions as suggestion}
					<button
						on:click|stopPropagation|preventDefault={() => addValue(suggestion)}
						class="w-full cursor-pointer px-3 py-2 text-left hover:bg-blue-500 hover:text-white"
					>
						{suggestion.displayName}
						{#if suggestion.createdByName}
							<span class="text-xs text-gray-500"> by {suggestion.createdByName}</span>
						{/if}
					</button>
				{/each}
			</div>
		{/if}
	</div>
{/if}
