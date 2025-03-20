<script lang="ts">
	import { base } from "$app/paths";

	import Logo from "$lib/components/icons/Logo.svelte";
	import { switchTheme } from "$lib/switchTheme";
	import { isAborted } from "$lib/stores/isAborted";
	import { env as envPublic } from "$env/dynamic/public";
	import NavConversationItem from "./NavConversationItem.svelte";
	import type { LayoutData } from "../../routes/$types";
	import type { ConvSidebar } from "$lib/types/ConvSidebar";
	import type { Model } from "$lib/types/Model";
	import { page } from "$app/stores";
	import InfiniteScroll from "./InfiniteScroll.svelte";
	import type { Conversation } from "$lib/types/Conversation";
	import { CONV_NUM_PER_PAGE } from "$lib/constants/pagination";
	import { goto } from "$app/navigation";

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

	const titles: { [key: string]: string } = {
		today: "Today",
		week: "This week",
		month: "This month",
		older: "Older",
	} as const;

	const nModels: number = $page.data.models.filter((el: Model) => !el.unlisted).length;

	async function handleVisible() {
		p++;
		const newConvs = await fetch(`${base}/api/v2/conversations?p=${p}`)
			.then((res) => res.json())
			.then((convs) =>
				convs.map(
					(conv: Pick<Conversation, "_id" | "title" | "updatedAt" | "model" | "assistantId">) => ({
						...conv,
						updatedAt: new Date(conv.updatedAt),
					})
				)
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
</script>

<div
	class="sticky top-0 flex flex-none touch-none items-center justify-between px-1.5 py-3.5 max-sm:pt-0"
>
	<a
		class="flex items-center rounded-xl text-lg font-semibold"
		href="{envPublic.PUBLIC_ORIGIN}{base}/"
	>
		<Logo classNames="mr-1" />
		{envPublic.PUBLIC_APP_NAME}
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
	class="mt-0.5 flex touch-none flex-col gap-1 rounded-r-xl p-3 text-sm md:bg-gradient-to-l md:from-gray-50 md:dark:from-gray-800/30"
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
		<button
			onclick={async () => {
				const response = await fetch(`${base}/login`, {
					method: "POST",
					credentials: "include",
				});
				if (response.ok) {
					window.location.href = await response.text();
				}
			}}
			class="flex h-9 w-full flex-none items-center gap-1.5 rounded-lg pl-2.5 pr-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
		>
			Login
		</button>
	{/if}
	<button
		onclick={switchTheme}
		type="button"
		class="flex h-9 flex-none items-center gap-1.5 rounded-lg pl-2.5 pr-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
	>
		Theme
	</button>
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

	<a
		href="{base}/settings"
		class="flex h-9 flex-none items-center gap-1.5 rounded-lg pl-2.5 pr-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
	>
		Settings
	</a>
	{#if envPublic.PUBLIC_APP_NAME === "HuggingChat"}
		<a
			href="{base}/privacy"
			class="flex h-9 flex-none items-center gap-1.5 rounded-lg pl-2.5 pr-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
		>
			About & Privacy
		</a>
	{/if}
</div>
