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
	import { switchTheme } from "$lib/switchTheme";
	import { isAborted } from "$lib/stores/isAborted";

	import NavConversationItem from "./NavConversationItem.svelte";
	import type { LayoutData } from "../../routes/$types";
	import type { ConvSidebar } from "$lib/types/ConvSidebar";
	import type { Model } from "$lib/types/Model";
	import { page } from "$app/stores";
	import InfiniteScroll from "./InfiniteScroll.svelte";
	import { CONV_NUM_PER_PAGE } from "$lib/constants/pagination";
	import { goto } from "$app/navigation";
	import { browser } from "$app/environment";
	import { toggleSearch } from "./chat/Search.svelte";
	import CarbonSearch from "~icons/carbon/search";
	import { closeMobileNav } from "./MobileNav.svelte";
	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";

	import { isVirtualKeyboard } from "$lib/utils/isVirtualKeyboard";
	import { useAPIClient, throwOnError } from "$lib/APIClient";
	import { jsonSerialize } from "$lib/utils/serialize";

	const publicConfig = usePublicConfig();
	const client = useAPIClient();

	interface Props {
		conversations: ConvSidebar[];
		canLogin: boolean;
		user: LayoutData["user"];
		p?: number;
	}

	let { conversations = $bindable(), canLogin, user, p = $bindable(0) }: Props = $props();

	let hasMore = $state(true);

	function handleNewChatClick() {
		isAborted.set(true);
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

	const nModels: number = $page.data.models.filter((el: Model) => !el.unlisted).length;

	async function handleVisible() {
		p++;
		const newConvs = await client.conversations
			.get({
				query: {
					p,
				},
			})
			.then(throwOnError)
			.then(({ conversations }) =>
				conversations.map((conv) => ({
					...jsonSerialize(conv),
					updatedAt: new Date(conv.updatedAt),
				}))
			)
			.catch(() => []);

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

	let theme = $state(browser ? localStorage.theme : "light");
</script>

<div
	class="sticky top-0 flex flex-none touch-none items-center justify-between px-1.5 py-3.5 max-sm:pt-0"
>
	<a
		class="flex items-center rounded-xl text-lg font-semibold"
		href="{publicConfig.PUBLIC_ORIGIN}{base}/"
	>
		<Logo classNames="mr-1" />
		{publicConfig.PUBLIC_APP_NAME}
	</a>
	{#if $page.url.pathname !== base + "/"}
		<a
			href={`${base}/`}
			onclick={handleNewChatClick}
			class="flex rounded-lg border bg-white px-2 py-0.5 text-center shadow-sm hover:shadow-none dark:border-gray-600 dark:bg-gray-700 sm:text-smd"
		>
			New Chat
		</a>
	{/if}
</div>
<div
	class="scrollbar-custom flex touch-pan-y flex-col gap-1 overflow-y-auto rounded-r-xl from-gray-50 px-3 pb-3 pt-2 text-[.9rem] dark:from-gray-800/30 max-sm:bg-gradient-to-t md:bg-gradient-to-l"
>
	<button
		class="group mx-auto flex w-full flex-row items-center justify-stretch gap-x-2 rounded-xl px-2 py-1 align-middle text-gray-600 hover:bg-gray-500/20 dark:text-gray-400"
		onclick={() => {
			closeMobileNav();
			toggleSearch();
		}}
	>
		<CarbonSearch class="text-xs" />
		<span class="block">Search chats</span>
		{#if !isVirtualKeyboard()}
			<span class="invisible ml-auto text-xs text-gray-500 group-hover:visible"
				><kbd>ctrl</kbd>+<kbd>k</kbd></span
			>
		{/if}
	</button>
	{#await groupedConversations}
		{#if $page.data.nConversations > 0}
			<div class="overflow-y-hidden">
				<div class="flex animate-pulse flex-col gap-4">
					<div class="h-4 w-24 rounded bg-gray-200 dark:bg-gray-700"></div>
					{#each Array(100) as _}
						<div class="ml-2 h-5 w-4/5 gap-5 rounded bg-gray-200 dark:bg-gray-700"></div>
					{/each}
				</div>
			</div>
		{/if}
	{:then groupedConversations}
		<div class="flex flex-col gap-1">
			{#each Object.entries(groupedConversations) as [group, convs]}
				{#if convs.length}
					<h4 class="mb-1.5 mt-4 pl-0.5 text-sm text-gray-400 first:mt-0 dark:text-gray-500">
						{titles[group]}
					</h4>
					{#each convs as conv}
						<NavConversationItem on:editConversationTitle on:deleteConversation {conv} />
					{/each}
				{/if}
			{/each}
		</div>
		{#if hasMore}
			<InfiniteScroll on:visible={handleVisible} />
		{/if}
	{/await}
</div>
<div
	class="flex touch-none flex-col gap-1 rounded-r-xl p-3 text-sm md:mt-3 md:bg-gradient-to-l md:from-gray-50 md:dark:from-gray-800/30"
>
	{#if user?.username || user?.email}
		<button
			onclick={async () => {
				await fetch(`${base}/logout`, {
					method: "POST",
				});
				await goto(base + "/", { invalidateAll: true });
			}}
			class="group flex items-center gap-1.5 rounded-lg pl-2.5 pr-2 hover:bg-gray-100 dark:hover:bg-gray-700"
		>
			<span
				class="flex h-9 flex-none shrink items-center gap-1.5 truncate pr-2 text-gray-500 dark:text-gray-400"
				>{user?.username || user?.email}</span
			>
			{#if !user.logoutDisabled}
				<span
					class="ml-auto h-6 flex-none items-center gap-1.5 rounded-md border bg-white px-2 text-gray-700 shadow-sm group-hover:flex hover:shadow-none dark:border-gray-600 dark:bg-gray-600 dark:text-gray-400 dark:hover:text-gray-300 md:hidden"
				>
					Sign Out
				</span>
			{/if}
		</button>
	{/if}
	{#if canLogin}
		<a
			href="{base}/login"
			class="flex h-9 w-full flex-none items-center gap-1.5 rounded-lg pl-2.5 pr-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
		>
			Login
		</a>
	{/if}
	{#if nModels > 1}
		<a
			href="{base}/models"
			class="flex h-9 flex-none items-center gap-1.5 rounded-lg pl-2.5 pr-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
		>
			Models
			<span
				class="ml-auto rounded-full border border-gray-300 px-2 py-0.5 text-xs text-gray-500 dark:border-gray-500 dark:text-gray-400"
				>{nModels}</span
			>
		</a>
	{/if}
	{#if $page.data.enableAssistants}
		<a
			href="{base}/assistants"
			class="flex h-9 flex-none items-center gap-1.5 rounded-lg pl-2.5 pr-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
		>
			Assistants
		</a>
	{/if}
	{#if $page.data.enableCommunityTools}
		<a
			href="{base}/tools"
			class="flex h-9 flex-none items-center gap-1.5 rounded-lg pl-2.5 pr-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
		>
			Tools
			<span
				class="ml-auto rounded-full border border-purple-300 px-2 py-0.5 text-xs text-purple-500 dark:border-purple-500 dark:text-purple-400"
				>New</span
			>
		</a>
	{/if}

	<span class="flex flex-row-reverse gap-1 md:flex-row">
		<a
			href="{base}/settings"
			class="flex h-9 flex-none flex-grow items-center gap-1.5 rounded-lg pl-2.5 pr-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
		>
			Settings
		</a>
		<button
			onclick={() => {
				switchTheme();
				theme = localStorage.theme;
			}}
			aria-label="Toggle theme"
			class="flex h-9 min-w-[1.5em] flex-none items-center rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
		>
			{#if browser}
				{#if theme === "dark"}
					<svg
						xmlns="http://www.w3.org/2000/svg"
						xmlns:xlink="http://www.w3.org/1999/xlink"
						aria-hidden="true"
						focusable="false"
						role="img"
						width="1em"
						height="1em"
						preserveAspectRatio="xMidYMid meet"
						viewBox="0 0 32 32"
						stroke-width="1.5"
						><path
							d="M16 12.005a4 4 0 1 1-4 4a4.005 4.005 0 0 1 4-4m0-2a6 6 0 1 0 6 6a6 6 0 0 0-6-6z"
							fill="currentColor"
							stroke="currentColor"
							stroke-width="0.5"
						></path><path d="M5.394 6.813l1.414-1.415l3.506 3.506L8.9 10.318z" fill="currentColor"
						></path><path d="M2 15.005h5v2H2z" fill="currentColor"></path><path
							stroke="currentColor"
							stroke-width="0.5"
							d="M5.394 25.197L8.9 21.691l1.414 1.415l-3.506 3.505z"
							fill="currentColor"
						></path><path d="M15 25.005h2v5h-2z" fill="currentColor"></path><path
							stroke="currentColor"
							stroke-width="0.5"
							d="M21.687 23.106l1.414-1.415l3.506 3.506l-1.414 1.414z"
							fill="currentColor"
						></path><path d="M25 15.005h5v2h-5z" fill="currentColor"></path><path
							stroke="currentColor"
							stroke-width="0.5"
							d="M21.687 8.904l3.506-3.506l1.414 1.415l-3.506 3.505z"
							fill="currentColor"
						></path><path d="M15 2.005h2v5h-2z" fill="currentColor"></path></svg
					>
				{:else}
					<svg
						xmlns="http://www.w3.org/2000/svg"
						xmlns:xlink="http://www.w3.org/1999/xlink"
						aria-hidden="true"
						focusable="false"
						role="img"
						width="1em"
						height="1em"
						preserveAspectRatio="xMidYMid meet"
						viewBox="0 0 32 32"
						stroke-width="1.5"
						><path
							d="M13.502 5.414a15.075 15.075 0 0 0 11.594 18.194a11.113 11.113 0 0 1-7.975 3.39c-.138 0-.278.005-.418 0a11.094 11.094 0 0 1-3.2-21.584M14.98 3a1.002 1.002 0 0 0-.175.016a13.096 13.096 0 0 0 1.825 25.981c.164.006.328 0 .49 0a13.072 13.072 0 0 0 10.703-5.555a1.01 1.01 0 0 0-.783-1.565A13.08 13.08 0 0 1 15.89 4.38A1.015 1.015 0 0 0 14.98 3z"
							fill="currentColor"
							stroke="currentColor"
							stroke-width="0.5"
						></path></svg
					>
				{/if}
			{/if}
		</button>
	</span>
</div>
