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
	import { onDestroy } from "svelte";

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
	import { isPro } from "$lib/stores/isPro";
	import IconPro from "$lib/components/icons/IconPro.svelte";
	import MCPServerManager from "./mcp/MCPServerManager.svelte";

	const publicConfig = usePublicConfig();
	const client = useAPIClient();

	// Search state
	let searchQuery = $state("");
	let searchResults = $state<ConvSidebar[]>([]);
	let isSearching = $state(false);
	let searchTimeout: ReturnType<typeof setTimeout> | null = null;
	let searchInputEl: HTMLInputElement | undefined = $state();

	async function performSearch(query: string) {
		if (!query.trim()) {
			searchResults = [];
			isSearching = false;
			return;
		}

		isSearching = true;
		try {
			const results = await client.conversations.search
				.get({ query: { q: query } })
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

		if (searchTimeout) {
			clearTimeout(searchTimeout);
		}

		searchTimeout = setTimeout(() => {
			performSearch(searchQuery);
		}, 300);
	}

	function clearSearch() {
		searchQuery = "";
		searchResults = [];
		if (searchTimeout) {
			clearTimeout(searchTimeout);
		}
	}

	const isSearchMode = $derived(searchQuery.trim().length > 0);

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
		today: conversations.filter(({ updatedAt }) => updatedAt.getTime() > dateRanges[0]),
		week: conversations.filter(
			({ updatedAt }) => updatedAt.getTime() > dateRanges[1] && updatedAt.getTime() < dateRanges[0]
		),
		month: conversations.filter(
			({ updatedAt }) => updatedAt.getTime() > dateRanges[2] && updatedAt.getTime() < dateRanges[1]
		),
		older: conversations.filter(({ updatedAt }) => updatedAt.getTime() < dateRanges[2]),
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

<div
	class="scrollbar-custom flex touch-pan-y flex-col gap-1 overflow-y-auto rounded-r-xl border border-l-0 border-gray-100 from-gray-50 px-3 pb-3 pt-2 text-[.9rem] dark:border-transparent dark:from-gray-800/30 max-sm:bg-gradient-to-t md:bg-gradient-to-l"
>
	<!-- Search input -->
	<div class="relative mb-2">
		<input
			bind:this={searchInputEl}
			type="text"
			placeholder="Search conversations..."
			value={searchQuery}
			oninput={handleSearchInput}
			class="w-full rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-8 text-sm placeholder-gray-400 focus:border-gray-300 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:placeholder-gray-500"
		/>
		<svg
			class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-gray-400"
			fill="none"
			stroke="currentColor"
			viewBox="0 0 24 24"
		>
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
			/>
		</svg>
		{#if searchQuery}
			<button
				onclick={clearSearch}
				class="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
				aria-label="Clear search"
			>
				<svg class="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M6 18L18 6M6 6l12 12"
					/>
				</svg>
			</button>
		{/if}
	</div>

	<div class="flex flex-col gap-0.5">
		{#if isSearchMode}
			<!-- Search results -->
			{#if isSearching}
				<p class="py-2 text-center text-sm text-gray-400">Searching...</p>
			{:else if searchResults.length === 0}
				<p class="py-2 text-center text-sm text-gray-400">No conversations found</p>
			{:else}
				<h4 class="mb-1.5 pl-0.5 text-sm text-gray-400 dark:text-gray-500">
					Search Results ({searchResults.length})
				</h4>
				{#each searchResults as conv}
					<NavConversationItem {conv} {oneditConversationTitle} {ondeleteConversation} />
				{/each}
			{/if}
		{:else}
			<!-- Normal grouped conversations -->
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
	{#if !isSearchMode && hasMore}
		<InfiniteScroll onvisible={handleVisible} />
	{/if}
</div>
<div
	class="flex touch-none flex-col gap-1 rounded-r-xl border border-l-0 border-gray-100 p-3 text-sm dark:border-transparent md:mt-3 md:bg-gradient-to-l md:from-gray-50 md:dark:from-gray-800/30"
>
	{#if user?.username || user?.email}
		<div
			class="group flex items-center gap-1.5 rounded-lg pl-2.5 pr-2 hover:bg-gray-100 first:hover:bg-transparent dark:hover:bg-gray-700 first:dark:hover:bg-transparent"
		>
			<span
				class="flex h-9 flex-none shrink items-center gap-1.5 truncate pr-2 text-gray-500 dark:text-gray-400"
				>{user?.username || user?.email}</span
			>

			{#if publicConfig.isHuggingChat && $isPro === false}
				<a
					href="https://huggingface.co/subscribe/pro?from=HuggingChat"
					target="_blank"
					rel="noopener noreferrer"
					class="ml-auto flex h-[20px] items-center gap-1 rounded-md bg-gradient-to-r from-pink-500/10 via-green-500/10 to-green-500/5 px-1.5 py-0.5 text-xs text-gray-500 hover:from-pink-500/20 hover:via-green-500/20 dark:from-pink-500/20 dark:via-green-500/20 dark:to-green-500/10 dark:text-gray-400 dark:hover:from-pink-500/30 dark:hover:via-green-500/30"
				>
					<IconPro />
					Get PRO
				</a>
			{:else if publicConfig.isHuggingChat && $isPro === true}
				<span
					class="ml-auto flex h-[20px] items-center gap-1 rounded-md bg-gradient-to-r from-pink-500/10 via-green-500/10 to-green-500/5 px-1.5 py-0.5 text-xs text-gray-500 hover:from-pink-500/20 hover:via-green-500/20 dark:from-pink-500/20 dark:via-green-500/20 dark:to-green-500/10 dark:text-gray-400 dark:hover:from-pink-500/30 dark:hover:via-green-500/30"
				>
					<IconPro />
					PRO
				</span>
			{/if}

			<img
				src="https://huggingface.co/api/users/{user.username}/avatar?redirect=true"
				class="{!(publicConfig.isHuggingChat && $isPro !== null)
					? 'ml-auto'
					: ''} size-4 rounded-full border bg-gray-500 dark:border-white/40"
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
