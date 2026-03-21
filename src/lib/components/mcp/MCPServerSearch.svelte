<script lang="ts">
	import { onMount } from "svelte";
	import type { MCPRegistryEntry, MCPServer } from "$lib/types/Tool";
	import RegistryResultCard from "./RegistryResultCard.svelte";
	import IconSearch from "~icons/carbon/search";

	interface Props {
		existingServers: MCPServer[];
		onadd: (entry: MCPRegistryEntry) => void;
	}

	let { existingServers, onadd }: Props = $props();

	let query = $state("");
	let results = $state<MCPRegistryEntry[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	const existingUrls = $derived(new Set(existingServers.map((s) => s.url).filter(Boolean)));

	function isAlreadyAdded(entry: MCPRegistryEntry): boolean {
		return !!entry.url && existingUrls.has(entry.url);
	}

	async function fetchResults(q: string) {
		loading = true;
		error = null;
		try {
			const params = new URLSearchParams({ limit: "20" });
			if (q) params.set("search", q);
			const res = await fetch(`/api/mcp/registry?${params}`);
			if (!res.ok) throw new Error(await res.text());
			results = (await res.json()) as MCPRegistryEntry[];
		} catch (err) {
			error = err instanceof Error ? err.message : "Failed to load registry";
			results = [];
		} finally {
			loading = false;
		}
	}

	function handleInput() {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			fetchResults(query);
		}, 300);
	}

	onMount(() => {
		fetchResults("");
		return () => {
			if (debounceTimer) clearTimeout(debounceTimer);
		};
	});
</script>

<div class="flex flex-col gap-3">
	<!-- Search input -->
	<div class="relative">
		<IconSearch class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
		<input
			type="search"
			bind:value={query}
			oninput={handleInput}
			placeholder="Search MCP servers (e.g. github, web search, database…)"
			class="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
		/>
	</div>

	<!-- States -->
	{#if loading}
		<div class="flex items-center justify-center py-8 text-sm text-gray-500 dark:text-gray-400">
			<span class="animate-pulse">Searching registry…</span>
		</div>
	{:else if error}
		<div
			class="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20"
		>
			<p class="text-sm text-red-800 dark:text-red-200">
				Registry unavailable: {error}
			</p>
		</div>
	{:else if results.length === 0 && query}
		<div class="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
			No servers found for "<strong>{query}</strong>". Try the Manual tab to add a custom URL.
		</div>
	{:else}
		<div class="scrollbar-custom flex max-h-[420px] flex-col gap-2 overflow-y-auto pr-0.5">
			{#each results as entry (entry.name)}
				<RegistryResultCard {entry} alreadyAdded={isAlreadyAdded(entry)} {onadd} />
			{/each}
		</div>
	{/if}
</div>
