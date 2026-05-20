<script lang="ts" module>
	const titles: { [key: string]: string } = {
		today: "Today",
		week: "This week",
		month: "This month",
		older: "Older",
	};
</script>

<script lang="ts">
	import { base } from "$app/paths";
	import { Command } from "bits-ui";
	import Modal from "./Modal.svelte";
	import InfiniteScroll from "./InfiniteScroll.svelte";
	import { searchModal } from "$lib/stores/searchModal";
	import { handleResponse, useAPIClient } from "$lib/APIClient";
	import { debounce } from "$lib/utils/debounce";
	import { highlightMatch } from "$lib/utils/highlightSearch";
	import type { ConvSearchResult } from "$lib/types/ConvSearchResult";
	import CarbonSearch from "~icons/carbon/search";

	const client = useAPIClient();

	let query = $state("");
	let page = $state(0);
	let results = $state<ConvSearchResult[]>([]);
	let hasMore = $state(false);
	let loading = $state(false);
	let selectedValue = $state("");
	let requestToken = 0;

	const dateRanges = [
		new Date().setDate(new Date().getDate() - 1),
		new Date().setDate(new Date().getDate() - 7),
		new Date().setMonth(new Date().getMonth() - 1),
	];

	let groupedResults = $derived({
		today: results.filter(({ updatedAt }) => updatedAt.getTime() > dateRanges[0]),
		week: results.filter(
			({ updatedAt }) => updatedAt.getTime() > dateRanges[1] && updatedAt.getTime() < dateRanges[0]
		),
		month: results.filter(
			({ updatedAt }) => updatedAt.getTime() > dateRanges[2] && updatedAt.getTime() < dateRanges[1]
		),
		older: results.filter(({ updatedAt }) => updatedAt.getTime() < dateRanges[2]),
	});

	async function fetchPage(q: string, p: number): Promise<ConvSearchResult[]> {
		try {
			const data = await client.conversations.search.get({ query: { q, p } }).then(handleResponse);
			if (!data) return [];
			return (data.conversations ?? []).map(
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				(c: any): ConvSearchResult => ({
					id: c.id ?? c._id,
					title: c.title,
					updatedAt: c.updatedAt instanceof Date ? c.updatedAt : new Date(c.updatedAt),
					model: c.model,
					description: c.description,
					matchedText: c.matchedText,
				})
			);
		} catch (err) {
			console.error(err);
			return [];
		}
	}

	const runSearch = debounce(async (q: string, token: number) => {
		if (!q || q.trim().length < 2) {
			results = [];
			hasMore = false;
			page = 0;
			loading = false;
			selectedValue = "";
			return;
		}

		const fetched = await fetchPage(q, 0);
		if (token !== requestToken) return; // a newer query superseded this one
		page = 0;
		results = fetched;
		hasMore = fetched.length > 0;
		selectedValue = fetched[0]?.id ? String(fetched[0].id) : "";
		loading = false;
	}, 250);

	async function loadMore() {
		if (!hasMore || loading || !query) return;
		loading = true;
		const next = page + 1;
		const more = await fetchPage(query, next);
		if (more.length === 0) {
			hasMore = false;
		} else {
			page = next;
			results = [...results, ...more];
		}
		loading = false;
	}

	$effect(() => {
		const q = query;
		// Flip to "loading" synchronously so the "No matches" state can't flash
		// during the 250 ms debounce window before the fetch starts.
		if (q.trim().length >= 2) {
			loading = true;
		}
		requestToken += 1;
		runSearch(q, requestToken);
	});

	function handleResultClick() {
		searchModal.close();
	}
</script>

{#if $searchModal}
	<Modal width="w-[640px]" onclose={() => searchModal.close()}>
		<Command.Root
			shouldFilter={false}
			loop
			bind:value={selectedValue}
			label="Search conversations"
			class="flex flex-col"
		>
			<div class="flex items-center gap-2 border-b border-gray-100 px-4 py-3 dark:border-gray-700">
				<CarbonSearch class="text-gray-400" />
				<Command.Input
					bind:value={query}
					autofocus
					placeholder="Search chats"
					class="min-w-0 flex-1 border-none bg-transparent p-0 text-base outline-none placeholder:text-gray-400 focus:ring-0 dark:text-gray-100"
				/>
				<kbd
					class="hidden rounded-md border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-400 dark:border-gray-600 sm:block"
					>esc</kbd
				>
			</div>

			<Command.List
				class="scrollbar-custom flex max-h-[60vh] flex-col gap-1 overflow-y-auto px-3 py-3 text-[.9rem]"
			>
				{#if query.trim().length < 2}
					<p class="px-2 py-6 text-center text-sm text-gray-400">
						Type at least 2 characters to search your conversations.
					</p>
				{:else if loading && results.length === 0}
					<Command.Loading class="px-2 py-6 text-center text-sm text-gray-400">
						Searching…
					</Command.Loading>
				{:else if !loading && results.length === 0}
					<p class="px-2 py-6 text-center text-sm text-gray-400">No matches.</p>
				{:else}
					{#each Object.entries(groupedResults) as [group, convs]}
						{#if convs.length}
							<Command.Group>
								<Command.GroupHeading
									class="mb-1 mt-3 pl-0.5 text-xs text-gray-400 first:mt-0 dark:text-gray-500"
								>
									{titles[group]}
								</Command.GroupHeading>
								<Command.GroupItems>
									{#each convs as conv (conv.id)}
										<Command.LinkItem
											href="{base}/conversation/{conv.id}"
											value={String(conv.id)}
											data-sveltekit-noscroll
											data-sveltekit-preload-data="tap"
											onclick={handleResultClick}
											class="block rounded-lg px-2 py-1.5 text-gray-700 data-[selected]:bg-gray-100 dark:text-gray-200 dark:data-[selected]:bg-gray-700"
										>
											<div class="truncate text-sm first-letter:uppercase">
												{conv.title}
											</div>
											{#if conv.description}
												<p class="mt-0.5 line-clamp-1 text-xs text-gray-500 dark:text-gray-400">
													<!-- eslint-disable-next-line svelte/no-at-html-tags -- input is HTML-escaped in highlightMatch() -->
													{@html highlightMatch(conv.description, conv.matchedText || query)}
												</p>
											{/if}
										</Command.LinkItem>
									{/each}
								</Command.GroupItems>
							</Command.Group>
						{/if}
					{/each}
					{#if hasMore}
						<InfiniteScroll onvisible={loadMore} />
					{/if}
				{/if}
			</Command.List>
		</Command.Root>
	</Modal>
{/if}
