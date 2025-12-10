<script lang="ts" module>
	export const titles: { [key: string]: string } = {
		today: "Today",
		week: "This week",
		month: "This month",
		older: "Older",
	} as const;
</script>

<script lang="ts">
	import { base } from "$app/paths";

	import Logo from "$lib/components/icons/Logo.svelte";
	import IconSun from "$lib/components/icons/IconSun.svelte";
	import IconMoon from "$lib/components/icons/IconMoon.svelte";
	import { switchTheme, subscribeToTheme } from "$lib/switchTheme";
	import { isAborted } from "$lib/stores/isAborted";
	import { onDestroy, tick } from "svelte";

	import NavConversationItem from "./NavConversationItem.svelte";
	import type { LayoutData } from "../../routes/$types";
	import type { ConvSidebar } from "$lib/types/ConvSidebar";
	import type { Model } from "$lib/types/Model";
	import { page } from "$app/state";
	import InfiniteScroll from "./InfiniteScroll.svelte";
	import { CONV_NUM_PER_PAGE } from "$lib/constants/pagination";
	import { browser } from "$app/environment";
	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";
	import { useAPIClient, handleResponse } from "$lib/APIClient";
	import { requireAuthUser } from "$lib/utils/auth";
	import { enabledServersCount } from "$lib/stores/mcpServers";
	import MCPServerManager from "./mcp/MCPServerManager.svelte";
	import IconSearch from "$lib/components/icons/IconSearch.svelte";

	const publicConfig = usePublicConfig();
	const client = useAPIClient();

	interface Props {
		conversations: ConvSidebar[];
		user: LayoutData["user"];
		p?: number;
		ondeleteConversation?: (id: string) => void;
		oneditConversationTitle?: (payload: { id: string; title: string }) => void;
	}

	let {
		conversations = $bindable(),
		user,
		p = $bindable(0),
		ondeleteConversation,
		oneditConversationTitle,
	}: Props = $props();

	let hasMore = $state(true);

	// Search state
	let searchQuery = $state("");
	let searchResults = $state<ConvSidebar[]>([]);
	let isSearching = $state(false);
	let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

	const isSearchActive = $derived(searchQuery.trim().length > 0);

	// The conversations to display (either search results or all conversations)
	const displayedConversations = $derived(isSearchActive ? searchResults : conversations);

	async function performSearch(query: string) {
		if (!query.trim()) {
			searchResults = [];
			isSearching = false;
			return;
		}

		isSearching = true;
		try {
			const results = await client.conversations
				.get({ query: { search: query.trim() } })
				.then(handleResponse)
				.then((r) => r.conversations)
				.catch((): ConvSidebar[] => []);
			searchResults = results;
		} finally {
			isSearching = false;
		}
	}

	function handleSearchInput(e: Event) {
		const target = e.target as HTMLInputElement;
		searchQuery = target.value;

		// Clear previous debounce timer
		if (searchDebounceTimer) {
			clearTimeout(searchDebounceTimer);
		}

		// Debounce search requests
		searchDebounceTimer = setTimeout(() => {
			performSearch(searchQuery);
		}, 300);
	}

	function clearSearch() {
		searchQuery = "";
		searchResults = [];
		isSearching = false;
		if (searchDebounceTimer) {
			clearTimeout(searchDebounceTimer);
		}
	}

	function handleNewChatClick(e: MouseEvent) {
		isAborted.set(true);

		if (requireAuthUser()) {
			e.preventDefault();
		}
	}

	function handleNavItemClick(e: MouseEvent) {
		if (requireAuthUser()) {
			e.preventDefault();
		}
	}

	const dateRanges = [
		new Date().setDate(new Date().getDate() - 1),
		new Date().setDate(new Date().getDate() - 7),
		new Date().setMonth(new Date().getMonth() - 1),
	];

	let groupedConversations = $derived({
		today: displayedConversations.filter(({ updatedAt }) => updatedAt.getTime() > dateRanges[0]),
		week: displayedConversations.filter(
			({ updatedAt }) => updatedAt.getTime() > dateRanges[1] && updatedAt.getTime() < dateRanges[0]
		),
		month: displayedConversations.filter(
			({ updatedAt }) => updatedAt.getTime() > dateRanges[2] && updatedAt.getTime() < dateRanges[1]
		),
		older: displayedConversations.filter(({ updatedAt }) => updatedAt.getTime() < dateRanges[2]),
	});

	const nModels: number = page.data.models.filter((el: Model) => !el.unlisted).length;

	async function handleVisible() {
		p++;
		const newConvs = await client.conversations
			.get({
				query: {
					p,
				},
			})
			.then(handleResponse)
			.then((r) => r.conversations)
			.catch((): ConvSidebar[] => []);

		if (newConvs.length === 0) {
			hasMore = false;
		}

		conversations = [...conversations, ...newConvs];
	}

	$effect(() => {
		if (conversations.length <= CONV_NUM_PER_PAGE) {
			// reset p to 0 if there's only one page of content
			// that would be caused by a data loading invalidation
			p = 0;
		}
	});

	let isDark = $state(false);
	let unsubscribeTheme: (() => void) | undefined;
	let showMcpModal = $state(false);

	if (browser) {
		unsubscribeTheme = subscribeToTheme(({ isDark: nextIsDark }) => {
			isDark = nextIsDark;
		});
	}

	onDestroy(() => {
		unsubscribeTheme?.();
	});
</script>

<div
	class="sticky top-0 flex flex-none touch-none items-center justify-between px-1.5 py-3.5 max-sm:pt-0"
>
	<a
		class="flex select-none items-center rounded-xl text-lg font-semibold"
		href="{publicConfig.PUBLIC_ORIGIN}{base}/"
	>
		<Logo classNames="dark:invert mr-[2px]" />
		{publicConfig.PUBLIC_APP_NAME}
	</a>
	<a
		href={`${base}/`}
		onclick={handleNewChatClick}
		class="flex rounded-lg border bg-white px-2 py-0.5 text-center shadow-sm hover:shadow-none dark:border-gray-600 dark:bg-gray-700 sm:text-smd"
		title="Ctrl/Cmd + Shift + O"
	>
		New Chat
	</a>
</div>

<!-- Search input -->
<div class="px-3 pb-2">
	<div class="relative">
		<div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5">
			<IconSearch classNames="size-4 text-gray-400" />
		</div>
		<input
			type="text"
			placeholder="Search conversations..."
			value={searchQuery}
			oninput={handleSearchInput}
			class="w-full rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-8 text-sm placeholder-gray-400 focus:border-gray-300 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:placeholder-gray-500 dark:focus:border-gray-500"
		/>
		{#if isSearchActive}
			<button
				onclick={clearSearch}
				class="absolute inset-y-0 right-0 flex items-center pr-2.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
				aria-label="Clear search"
			>
				<svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M18 6L6 18M6 6l12 12" />
				</svg>
			</button>
		{/if}
	</div>
</div>

<div
	class="scrollbar-custom flex touch-pan-y flex-col gap-1 overflow-y-auto rounded-r-xl border border-l-0 border-gray-100 from-gray-50 px-3 pb-3 pt-2 text-[.9rem] dark:border-transparent dark:from-gray-800/30 max-sm:bg-gradient-to-t md:bg-gradient-to-l"
>
	<div class="flex flex-none flex-col gap-0.5">
		{#if isSearching}
			<div class="flex items-center justify-center py-4 text-sm text-gray-400">
				Searching...
			</div>
		{:else if isSearchActive && searchResults.length === 0}
			<div class="flex items-center justify-center py-4 text-sm text-gray-400">
				No conversations found
			</div>
		{:else}
			{#each Object.entries(groupedConversations) as [group, convs]}
				{#if convs.length}
					<h4 class="mb-1.5 mt-4 pl-0.5 text-sm text-gray-400 first:mt-0 dark:text-gray-500">
						{titles[group]}
					</h4>
					{#each convs as conv}
						<NavConversationItem {conv} {oneditConversationTitle} {ondeleteConversation} />
					{/each}
				{/if}
			{/each}
		{/if}
	</div>
	{#if !isSearchActive && hasMore}
		<InfiniteScroll onvisible={handleVisible} />
	{/if}
</div>
<div
	class="flex touch-none flex-col gap-1 rounded-r-xl border border-l-0 border-gray-100 p-3 text-sm dark:border-transparent md:mt-3 md:bg-gradient-to-l md:from-gray-50 md:dark:from-gray-800/30"
>
	{#if user?.username || user?.email}
		<div
			class="group flex items-center gap-1.5 rounded-lg pl-2.5 pr-2 hover:bg-gray-100 dark:hover:bg-gray-700"
		>
			<span
				class="flex h-9 flex-none shrink items-center gap-1.5 truncate pr-2 text-gray-500 dark:text-gray-400"
				>{user?.username || user?.email}</span
			>

			<img
				src="https://huggingface.co/api/users/{user.username}/avatar?redirect=true"
				class="ml-auto size-4 rounded-full border bg-gray-500 dark:border-white/40"
				alt=""
			/>
		</div>
	{/if}
	<a
		href="{base}/models"
		class="flex h-9 flex-none items-center gap-1.5 rounded-lg pl-2.5 pr-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
		onclick={handleNavItemClick}
	>
		Models
		<span
			class="ml-auto rounded-md bg-gray-500/5 px-1.5 py-0.5 text-xs text-gray-400 dark:bg-gray-500/20 dark:text-gray-400"
			>{nModels}</span
		>
	</a>

	{#if user?.username || user?.email}
		<button
			onclick={() => (showMcpModal = true)}
			class="flex h-9 flex-none items-center gap-1.5 rounded-lg pl-2.5 pr-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
		>
			MCP Servers
			{#if $enabledServersCount > 0}
				<span
					class="ml-auto rounded-md bg-blue-600/10 px-1.5 py-0.5 text-xs text-blue-600 dark:bg-blue-600/20 dark:text-blue-400"
				>
					{$enabledServersCount}
				</span>
			{/if}
		</button>
	{/if}

	<span class="flex gap-1">
		<a
			href="{base}/settings/application"
			class="flex h-9 flex-none flex-grow items-center gap-1.5 rounded-lg pl-2.5 pr-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
			onclick={handleNavItemClick}
		>
			Settings
		</a>
		<button
			onclick={() => {
				switchTheme();
			}}
			aria-label="Toggle theme"
			class="flex size-9 min-w-[1.5em] flex-none items-center justify-center rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
		>
			{#if browser}
				{#if isDark}
					<IconSun />
				{:else}
					<IconMoon />
				{/if}
			{/if}
		</button>
	</span>
</div>

{#if showMcpModal}
	<MCPServerManager onclose={() => (showMcpModal = false)} />
{/if}
