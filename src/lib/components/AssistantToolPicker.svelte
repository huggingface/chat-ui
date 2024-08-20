<script lang="ts">
	import { base } from "$app/paths";
	import type { Tool } from "$lib/types/Tool";
	import { debounce } from "$lib/utils/debounce";

	export let selectedValues: {
		id: string;
		name: string;
	}[] = [];

	let inputValue = "";
	let maxValues = 3;

	let suggestions: {
		id: string;
		name: string;
	}[] = [];

	async function fetchSuggestions(query: string) {
		if (!query) {
			suggestions = [];
			return;
		}

		suggestions = (await fetch(`${base}/api/tools?q=${query}`)
			.then((res) => res.json())
			.then((res) =>
				res.map((el: Pick<Tool, "_id" | "displayName">) => ({ id: el._id, name: el.displayName }))
			)) satisfies {
			id: string;
			name: string;
		};
	}

	const debouncedFetch = debounce((query: string) => fetchSuggestions(query), 300);

	function addValue(value: { id: string; name: string }) {
		if (selectedValues.length < maxValues && !selectedValues.includes(value)) {
			selectedValues = [...selectedValues, value];
			inputValue = "";
			suggestions = [];
		}
	}

	function removeValue(id: string) {
		selectedValues = selectedValues.filter((v) => v.id !== id);
	}
</script>

{#if selectedValues.length > 0}
	<div class="flex items-center space-x-2">
		{#each selectedValues as value}
			<div class="flex items-center space-x-1 rounded border border-gray-300 bg-gray-200 px-2 py-1">
				<a
					href={`${base}/tools/${value.id}`}
					target="_blank"
					class="font-semibold text-blue-600 hover:underline">{value.name}</a
				>
				<button
					on:click|stopPropagation|preventDefault={() => removeValue(value.id)}
					class="text-xs text-red-500">✕</button
				>
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
						{suggestion.name}
					</button>
				{/each}
			</div>
		{/if}
	</div>
{/if}
