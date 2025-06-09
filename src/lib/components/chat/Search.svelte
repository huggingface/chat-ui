<script lang="ts" module>
	export function toggleSearch() {
		searchOpen = !searchOpen;
	}

	let searchOpen: boolean = $state(false);
</script>

<script lang="ts">
	import { debounce } from "$lib/utils/debounce";
	import NavConversationItem from "../NavConversationItem.svelte";
	import { titles } from "../NavMenu.svelte";
	import { beforeNavigate } from "$app/navigation";

	import CarbonClose from "~icons/carbon/close";
	import { fly } from "svelte/transition";
	import InfiniteScroll from "../InfiniteScroll.svelte";
	import { handleResponse, useAPIClient, type Success } from "$lib/APIClient";

	const client = useAPIClient();

	let searchContainer: HTMLDivElement | undefined = $state(undefined);
	let inputElement: HTMLInputElement | undefined = $state(undefined);

	let searchInput: string = $state("");
	let debouncedInput: string = $state("");
	let hasMore = $state(true);

	let pending: boolean = $state(false);

	let conversations: NonNullable<Success<typeof client.conversations.search.get>> = $state([]);

	let page: number = $state(0);

	const dateRanges = [
		new Date().setDate(new Date().getDate() - 1),
		new Date().setDate(new Date().getDate() - 7),
		new Date().setMonth(new Date().getMonth() - 1),
	];

	let groupedConversations = $derived({
		today: conversations.filter(({ updatedAt }) => updatedAt.getTime() > dateRanges[0]),
		week: conversations.filter(
			({ updatedAt }) => updatedAt.getTime() > dateRanges[1] && updatedAt.getTime() < dateRanges[0]
		),
		month: conversations.filter(
			({ updatedAt }) => updatedAt.getTime() > dateRanges[2] && updatedAt.getTime() < dateRanges[1]
		),
		older: conversations.filter(({ updatedAt }) => updatedAt.getTime() < dateRanges[2]),
	});

	const update = debounce(async (v: string) => {
		if (debouncedInput !== v) {
			conversations = [];
			page = 0;
			hasMore = true;
		}
		debouncedInput = v;
		pending = true;
		try {
			await handleVisible(v);
		} finally {
			pending = false;
		}
	}, 300);

	const handleBackdropClick = (event: MouseEvent) => {
		if (!searchOpen || !searchContainer) return;

		const target = event.target;
		if (!(target instanceof Node) || !searchContainer.contains(target)) {
			searchOpen = false;
		}
	};

	async function handleVisible(v: string) {
		const newConvs = await client.conversations.search
			.get({
				query: {
					q: v,
					p: page++,
				},
			})
			.then(handleResponse)
			.catch(() => []);

		if (newConvs.length === 0) {
			hasMore = false;
		}

		conversations = [...conversations, ...newConvs];
	}

	$effect(() => update(searchInput));

	function handleKeydown(event: KeyboardEvent) {
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
			if (!searchOpen) {
				searchOpen = true;
			}
			event.preventDefault();
			event.stopPropagation();
		}

		if (searchOpen && event.key === "Escape") {
			if (searchOpen) {
				searchOpen = false;
			}
			event.preventDefault();
		}
	}

	beforeNavigate(() => {
		searchOpen = false;
		searchInput = "";
	});

	$effect(() => {
		if (searchOpen) {
			inputElement?.focus();
		}
	});

	$effect(() => {
		if (!searchOpen) {
			searchInput = "";
			debouncedInput = ""; // reset debouncedInput on search bar close
		}
	});
</script>

<svelte:window onkeydown={handleKeydown} onmousedown={handleBackdropClick} />

{#if searchOpen}
	<div
		bind:this={searchContainer}
		class="fixed bottom-0 left-[5%] right-[5%] top-[10%] z-50
		m-4 mx-auto h-fit max-w-2xl
		overflow-hidden rounded-xl
		border border-gray-500/50 bg-gray-200 text-gray-800
		shadow-[0_10px_40px_rgba(100,100,100,0.2)]
		dark:bg-gray-800
		dark:text-gray-200 dark:shadow-[0_10px_40px_rgba(255,255,255,0.1)] lg:top-[20%]"
		in:fly={{ y: 100 }}
	>
		<button
			class="absolute right-1 top-2.5 rounded-full p-1 hover:bg-gray-500/50"
			onclick={toggleSearch}
		>
			<CarbonClose class="text-lg text-gray-400/80" />
		</button>
		<input
			bind:value={searchInput}
			bind:this={inputElement}
			type="text"
			name="searchbar"
			placeholder="Search for chats..."
			autocomplete="off"
			class={{
				"h-12 w-full p-4 text-lg dark:bg-gray-800 dark:text-gray-200": true,
				"border-b border-b-gray-500/50": searchInput && searchInput.length >= 3,
			}}
		/>

		<div class="scrollbar-custom max-h-[40dvh] overflow-y-scroll">
			{#if debouncedInput && debouncedInput.length >= 3}
				{#if pending}
					{#each Array(5) as _}
						<div
							class="m-2 h-6 w-full animate-pulse gap-5 rounded bg-gray-300 first:mt-4 dark:bg-gray-700"
						></div>
					{/each}
				{:else if conversations.length === 0}
					<p class="bg-gray-200 p-2 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
						No conversations found matching that query
					</p>
				{:else}
					{#each Object.entries(groupedConversations) as [group, convs]}
						{#if convs.length}
							<h4 class="mb-1.5 mt-4 pl-1.5 text-sm text-gray-700 dark:text-gray-300">
								{titles[group]}
							</h4>
							{#each convs as conv}
								<NavConversationItem
									{conv}
									readOnly={true}
									showDescription={true}
									description={conv.content}
									searchInput={conv.matchedText}
								/>
							{/each}
						{/if}
					{/each}
					{#if hasMore}
						<InfiniteScroll on:visible={() => handleVisible(searchInput)} />
					{/if}
				{/if}
			{/if}
		</div>
	</div>
{/if}
