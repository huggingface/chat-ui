<script lang="ts" module>
	export function toggleSearch() {
		searchOpen = !searchOpen;
	}

	export function closeSearch() {
		searchOpen = false;
	}

	let searchOpen: boolean = $state(false);
</script>

<script lang="ts">
	import { debounce } from "$lib/utils/debounce";
	import { onDestroy, onMount } from "svelte";

	import NavConversationItem from "../NavConversationItem.svelte";
	import { titles } from "../NavMenu.svelte";
	import { beforeNavigate } from "$app/navigation";
	import { browser } from "$app/environment";

	import CarbonClose from "~icons/carbon/close";
	import { fly } from "svelte/transition";
	import { useAPIClient, handleResponse } from "$lib/APIClient";
	import type { ConvSidebar } from "$lib/types/ConvSidebar";

	const client = useAPIClient();

	let inputElement: HTMLInputElement | undefined = $state(undefined);

	let searchInput: string = $state("");
	let debouncedInput: string = $state("");

	let pending: boolean = $state(false);

	let conversations: ConvSidebar[] = $state([]);

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
		debouncedInput = v;
		if (v.trim().length < 3) {
			conversations = [];
			return;
		}
		pending = true;
		try {
			const result = await client.conversations.search
				.get({ query: { q: v } })
				.then(handleResponse);
			conversations = result?.conversations ?? [];
		} catch {
			conversations = [];
		} finally {
			pending = false;
		}
	}, 300);

	$effect(() => update(searchInput));

	function onKeydown(ev: KeyboardEvent) {
		const appEl = document.getElementById("app");
		if (appEl?.hasAttribute("inert")) return;

		if ((ev.metaKey || ev.ctrlKey) && ev.key?.toLowerCase() === "k") {
			ev.preventDefault();
			ev.stopPropagation();
			searchOpen = !searchOpen;
		} else if (searchOpen && ev.key === "Escape") {
			ev.preventDefault();
			searchOpen = false;
		}
	}

	onMount(() => {
		if (!browser) return;
		window.addEventListener("keydown", onKeydown);
	});

	beforeNavigate(() => {
		searchOpen = false;
		searchInput = "";
	});

	onDestroy(() => {
		if (!browser) return;
		window.removeEventListener("keydown", onKeydown);
	});

	$effect(() => {
		if (searchOpen) {
			inputElement?.focus();
		}
	});

	$effect(() => {
		if (!searchOpen) {
			searchInput = "";
		}
	});
</script>

{#if searchOpen}
	<button
		aria-label="Close search"
		class="fixed inset-0 z-40 cursor-default bg-black/30 backdrop-blur-sm"
		onclick={() => (searchOpen = false)}
	></button>
	<div
		class="fixed bottom-0 left-[5%] right-[5%] top-[10%] z-50 m-4 mx-auto h-fit max-w-2xl overflow-hidden rounded-xl border border-gray-500/50 bg-gray-200 text-gray-800 shadow-[0_10px_40px_rgba(100,100,100,0.2)] dark:bg-gray-800 dark:text-gray-200 dark:shadow-[0_10px_40px_rgba(255,255,255,0.1)] lg:top-[20%]"
		in:fly={{ y: 100 }}
	>
		<button
			class="absolute right-1 top-2.5 rounded-full p-1 hover:bg-gray-500/50"
			onclick={() => (searchOpen = false)}
			aria-label="Close search"
		>
			<CarbonClose class="text-lg text-gray-400/80" />
		</button>
		<input
			bind:value={searchInput}
			bind:this={inputElement}
			type="text"
			name="searchbar"
			placeholder="Search for chats..."
			class={{
				"h-12 w-full p-4 text-lg dark:bg-gray-800 dark:text-gray-200": true,
				"border-b border-b-gray-500/50": searchInput && searchInput.length >= 3,
			}}
		/>

		<div class="max-h-[50dvh] overflow-y-auto">
			{#if debouncedInput && debouncedInput.length >= 3}
				{#if pending}
					{#each Array(5) as _}
						<div
							class="m-2 h-6 w-full animate-pulse gap-5 rounded bg-gray-300 first:mt-4 dark:bg-gray-700"
						></div>
					{/each}
				{:else if conversations.length === 0}
					<p class="bg-gray-200 p-4 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
						No conversations found matching that query
					</p>
				{:else}
					<div class="p-2">
						{#each Object.entries(groupedConversations) as [group, convs]}
							{#if convs.length}
								<h4 class="mb-1.5 mt-2 pl-1.5 text-sm text-gray-400 first:mt-0 dark:text-gray-500">
									{titles[group]}
								</h4>
								{#each convs as conv}
									<NavConversationItem {conv} readOnly />
								{/each}
							{/if}
						{/each}
					</div>
				{/if}
			{:else}
				<p class="p-4 text-sm text-gray-500 dark:text-gray-400">
					Type at least 3 characters to search your conversations.
				</p>
			{/if}
		</div>
	</div>
{/if}
