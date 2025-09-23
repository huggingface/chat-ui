<script lang="ts">
	import { Command } from "bits-ui";
	import { goto } from "$app/navigation";
	import { base } from "$app/paths";
	import { page } from "$app/state";

	import { debounce } from "$lib/utils/debounce";
	import { handleResponse, useAPIClient } from "$lib/APIClient";
	import { titles } from "../NavMenu.svelte";

	import CarbonSearch from "~icons/carbon/search";
	import CarbonTime from "~icons/carbon/time";
	import { onMount } from "svelte";

	const client = useAPIClient();

	type IdLike = string | { toString(): string };

	interface ConversationSearchResult {
		_id: string;
		id: string;
		title: string;
		content?: string;
		updatedAt: Date;
		model: string;
	}

	type ConversationSearchResponse = Array<{
		_id: IdLike;
		id: IdLike;
		title: string;
		content?: string;
		updatedAt: Date | string;
		model: string;
	}>;

	let open = $state(false);
	let query = $state("");
	let debounced = $state("");
	let loading = $state(false);
	let hasMore = $state(false);
	let pageIndex = $state(0);
	let inputEl = $state<HTMLInputElement | null>(null);
	let listEl = $state<HTMLDivElement | null>(null);

	let results: ConversationSearchResult[] = $state([]);

	const dateRanges = [
		new Date().setDate(new Date().getDate() - 1),
		new Date().setDate(new Date().getDate() - 7),
		new Date().setMonth(new Date().getMonth() - 1),
	];

	let groupedResults = $derived(() => {
		const normalizeDate = (value: ConversationSearchResult["updatedAt"]) =>
			value instanceof Date ? value.getTime() : new Date(value).getTime();

		return {
			today: results.filter(({ updatedAt }) => normalizeDate(updatedAt) > dateRanges[0]),
			week: results.filter(({ updatedAt }) => {
				const time = normalizeDate(updatedAt);
				return time > dateRanges[1] && time <= dateRanges[0];
			}),
			month: results.filter(({ updatedAt }) => {
				const time = normalizeDate(updatedAt);
				return time > dateRanges[2] && time <= dateRanges[1];
			}),
			older: results.filter(({ updatedAt }) => normalizeDate(updatedAt) <= dateRanges[2]),
		};
	});

	function resetSearchState() {
		query = "";
		debounced = "";
		pageIndex = 0;
		results = [];
		hasMore = false;
	}

	async function fetchResults(reset = false) {
		if (loading || debounced.length < 3) return;

		loading = true;
		try {
			const response: ConversationSearchResponse = await client.conversations.search
				.get({
					query: {
						q: debounced,
						p: reset ? 0 : pageIndex,
					},
				})
				.then(handleResponse)
				.catch((): ConversationSearchResponse => []);

			const normalized: ConversationSearchResult[] = response.map((conv) => ({
				_id: conv._id.toString(),
				id: conv.id.toString(),
				title: conv.title,
				content: conv.content,
				model: conv.model,
				updatedAt:
					conv.updatedAt instanceof Date
						? conv.updatedAt
						: new Date(conv.updatedAt ?? new Date().toISOString()),
			}));

			results = reset ? normalized : [...results, ...normalized];
			hasMore = response.length === 5;
			if (response.length > 0 || reset) {
				pageIndex = reset ? 1 : pageIndex + 1;
			}
		} finally {
			loading = false;
		}
	}

	const runSearch = debounce(async (value: string) => {
		debounced = value.trim();
		pageIndex = 0;
		results = [];
		hasMore = false;

		if (debounced.length < 3) {
			return;
		}

		await fetchResults(true);
	}, 250);

	$effect(() => {
		if (!open) {
			resetSearchState();
			return;
		}

		runSearch(query);
	});

	function closeCommand() {
		open = false;
	}

	async function handleSelect(id: string) {
		closeCommand();
		await goto(`${base}/conversation/${id}`, { invalidateAll: true });
	}

	function onListScroll(event: Event) {
		if (!hasMore || loading) return;
		const element = event.currentTarget as HTMLDivElement;
		const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
		if (remaining < 96) {
			fetchResults();
		}
	}

	$effect(() => {
		const element = listEl;
		if (!element) {
			return;
		}

		const handler = (event: Event) => onListScroll(event);
		element.addEventListener("scroll", handler, { passive: true });
		return () => element.removeEventListener("scroll", handler);
	});

	$effect(() => {
		if (open) {
			queueMicrotask(() => inputEl?.focus());
		}
	});

	function handleGlobalKeydown(event: KeyboardEvent) {
		const appEl = document.getElementById("app");
		if (appEl?.hasAttribute("inert")) return;

		const metaOrCtrl = event.metaKey || event.ctrlKey;
		if (metaOrCtrl && event.key.toLowerCase() === "k") {
			event.preventDefault();
			open = true;
			return;
		}

		if (event.key === "Escape" && open) {
			closeCommand();
		}
	}

	onMount(() => {
		window.addEventListener("keydown", handleGlobalKeydown, { capture: true });
		return () => window.removeEventListener("keydown", handleGlobalKeydown, { capture: true });
	});
</script>

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-3 py-12 backdrop-blur-sm"
		onpointerdown={closeCommand}
	>
		<div
			class="mx-auto w-full max-w-xl overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900"
			onpointerdown={(event) => event.stopPropagation()}
		>
			<Command.Root class="flex w-full flex-col">
				<div
					class="flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700"
				>
					<CarbonSearch class="size-4 text-gray-400 dark:text-gray-500" />
					<Command.Input
						bind:ref={inputEl}
						value={query}
						oninput={(event) => (query = event.currentTarget.value)}
						placeholder="Search conversations..."
						class="flex-1 bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-400 dark:text-gray-100 dark:placeholder:text-gray-500"
					/>
				</div>
				<Command.List bind:ref={listEl} class="max-h-[320px] overflow-y-auto px-2 py-2">
					<Command.Viewport>
						{#if debounced.length < 3}
							<div
								class="flex flex-col items-center justify-center gap-2 py-10 text-center text-sm text-gray-500 dark:text-gray-400"
							>
								<CarbonTime class="size-5" />
								<span>Type at least 3 characters to search your chats.</span>
							</div>
						{:else if loading && results.length === 0}
							<div class="flex flex-col gap-2 px-3 py-4">
								{#each Array(5) as _, index}
									<div
										class="h-10 animate-pulse rounded-md bg-gray-200 dark:bg-gray-700"
										style={`animation-delay: ${index * 60}ms`}
									></div>
								{/each}
							</div>
						{:else if results.length === 0}
							<Command.Empty class="px-3 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
								No conversations found.
							</Command.Empty>
						{:else}
							{#each Object.entries(groupedResults) as [groupName, convs]}
								{#if convs.length}
									<Command.Group>
										<Command.GroupHeading
											class="px-3 pb-2 pt-4 text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500"
										>
											{titles[groupName]}
										</Command.GroupHeading>
										<Command.GroupItems class="flex flex-col gap-1 px-1">
											{#each convs as conv}
												<Command.Item
													value={String(conv.id)}
													onSelect={() => handleSelect(String(conv.id))}
													class="rounded-lg px-3 py-2 text-left text-sm text-gray-800 transition-colors data-[selected=true]:bg-gray-100 dark:text-gray-100 dark:data-[selected=true]:bg-gray-700"
												>
													<div class="flex flex-col gap-1">
														<span
															class={`truncate ${conv.id === page.params.id ? "font-semibold text-blue-600 dark:text-blue-400" : ""}`}
														>
															{conv.title}
														</span>
														{#if conv.content}
															<span class="line-clamp-2 text-xs text-gray-500 dark:text-gray-400">
																{conv.content}
															</span>
														{/if}
													</div>
												</Command.Item>
											{/each}
										</Command.GroupItems>
									</Command.Group>
								{/if}
							{/each}
						{/if}
					</Command.Viewport>
				</Command.List>
				{#if hasMore || loading}
					<div
						class="border-t border-gray-200 px-4 py-2 text-center text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400"
					>
						{#if loading}
							Loading more results…
						{:else}
							Scroll to load more
						{/if}
					</div>
				{/if}
			</Command.Root>
		</div>
	</div>
{/if}
