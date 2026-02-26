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
	import NavConversationGroup from "./NavConversationGroup.svelte";
	import DragOverlay from "./DragOverlay.svelte";
	import type { LayoutData } from "../../routes/$types";
	import type { ConvSidebar } from "$lib/types/ConvSidebar";
	import type { ConvGroupSidebar } from "$lib/types/ConvGroupSidebar";
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
	import { dragState, updateDragPosition, endDrag } from "$lib/stores/dragState";

	const publicConfig = usePublicConfig();
	const client = useAPIClient();

	type SidebarEntry =
		| { type: "conversation"; conv: ConvSidebar; updatedAt: Date }
		| { type: "group"; group: ConvGroupSidebar; updatedAt: Date };

	interface Props {
		conversations: ConvSidebar[];
		groups?: ConvGroupSidebar[];
		user: LayoutData["user"];
		p?: number;
		ondeleteConversation?: (id: string) => void;
		oneditConversationTitle?: (payload: { id: string; title: string }) => void;
		oncreateGroup?: (convIds: string[]) => void;
		ondeleteGroup?: (id: string) => void;
		oneditGroupName?: (payload: { id: string; name: string }) => void;
		ontoggleGroupCollapse?: (payload: { id: string; isCollapsed: boolean }) => void;
		onaddToGroup?: (payload: { groupId: string; convId: string }) => void;
		onremoveFromGroup?: (payload: { groupId: string; convId: string }) => void;
	}

	let {
		conversations = $bindable(),
		groups = [],
		user,
		p = $bindable(0),
		ondeleteConversation,
		oneditConversationTitle,
		oncreateGroup,
		ondeleteGroup,
		oneditGroupName,
		ontoggleGroupCollapse,
		onaddToGroup,
		onremoveFromGroup,
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

	function getTimeBucket(ts: number): string {
		if (ts > dateRanges[0]) return "today";
		if (ts > dateRanges[1]) return "week";
		if (ts > dateRanges[2]) return "month";
		return "older";
	}

	let groupedEntries = $derived.by(() => {
		const buckets: Record<string, SidebarEntry[]> = {
			today: [],
			week: [],
			month: [],
			older: [],
		};

		// Add ungrouped conversations
		for (const conv of conversations) {
			const bucket = getTimeBucket(conv.updatedAt.getTime());
			buckets[bucket].push({ type: "conversation", conv, updatedAt: conv.updatedAt });
		}

		// Add groups by their effective updatedAt
		for (const group of groups) {
			const bucket = getTimeBucket(group.updatedAt.getTime());
			buckets[bucket].push({ type: "group", group, updatedAt: group.updatedAt });
		}

		// Sort each bucket by updatedAt desc
		for (const key of Object.keys(buckets)) {
			buckets[key].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
		}

		return buckets;
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

	// Drag coordination: global pointermove and pointerup
	function handleGlobalPointerMove(e: PointerEvent) {
		if ($dragState.isDragging) {
			e.preventDefault();
			updateDragPosition(e.clientX, e.clientY);
		}
	}

	function handleGlobalPointerUp() {
		if (!$dragState.isDragging) return;

		const { draggedConv, dropTarget, sourceGroupId } = $dragState;

		if (draggedConv && dropTarget) {
			const convId = draggedConv.id.toString();

			if (dropTarget.type === "conversation") {
				// Create new group with both conversations
				if (sourceGroupId) {
					// First remove from current group, then create new group
					onremoveFromGroup?.({ groupId: sourceGroupId, convId });
				}
				oncreateGroup?.([convId, dropTarget.id]);
			} else if (dropTarget.type === "group") {
				if (sourceGroupId && sourceGroupId !== dropTarget.id) {
					onremoveFromGroup?.({ groupId: sourceGroupId, convId });
				}
				onaddToGroup?.({ groupId: dropTarget.id, convId });
			}
		} else if (draggedConv && !dropTarget && sourceGroupId) {
			// Dropped outside any target while from a group → remove from group
			onremoveFromGroup?.({
				groupId: sourceGroupId,
				convId: draggedConv.id.toString(),
			});
		}

		endDrag();
	}
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

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="scrollbar-custom flex flex-col gap-1 overflow-y-auto rounded-r-xl border border-l-0 border-gray-100 from-gray-50 px-3 pb-3 pt-2 text-[.9rem] dark:border-transparent dark:from-gray-800/30 max-sm:bg-gradient-to-t md:bg-gradient-to-l
		{$dragState.isDragging ? 'touch-none' : 'touch-pan-y'}"
	onpointermove={handleGlobalPointerMove}
	onpointerup={handleGlobalPointerUp}
>
	<div class="flex flex-col gap-0.5">
		{#each Object.entries(groupedEntries) as [timeBucket, entries]}
			{#if entries.length}
				<h4 class="mb-1.5 mt-4 pl-0.5 text-sm text-gray-400 first:mt-0 dark:text-gray-500">
					{titles[timeBucket]}
				</h4>
				{#each entries as entry}
					{#if entry.type === "conversation"}
						<NavConversationItem
							conv={entry.conv}
							{oneditConversationTitle}
							{ondeleteConversation}
						/>
					{:else}
						<NavConversationGroup
							group={entry.group}
							{ondeleteConversation}
							{oneditConversationTitle}
							ondeleteGroup={(id) => ondeleteGroup?.(id)}
							oneditGroupName={(payload) => oneditGroupName?.(payload)}
							ontoggleCollapse={(payload) => ontoggleGroupCollapse?.(payload)}
						/>
					{/if}
				{/each}
			{/if}
		{/each}
	</div>
	{#if hasMore}
		<InfiniteScroll onvisible={handleVisible} />
	{/if}
</div>
<div
	class="flex touch-none flex-col gap-1 rounded-r-xl border border-l-0 border-gray-100 p-3 text-sm dark:border-transparent md:mt-3 md:bg-gradient-to-l md:from-gray-50 md:dark:from-gray-800/30"
>
	{#if user?.username || user?.email}
		<div
			class="group flex h-9 items-center gap-1.5 rounded-lg pl-2.5 pr-2 hover:bg-gray-100 first:hover:bg-transparent dark:hover:bg-gray-700 first:dark:hover:bg-transparent"
		>
			<img
				src="https://huggingface.co/api/users/{user.username}/avatar?redirect=true"
				class="size-3.5 rounded-full border bg-gray-500 dark:border-white/40"
				alt=""
			/>
			<span
				class="flex flex-none shrink items-center gap-1.5 truncate pr-2 text-gray-500 dark:text-gray-400"
				>{user?.username || user?.email}</span
			>

			{#if publicConfig.isHuggingChat && $isPro === false}
				<a
					href="https://huggingface.co/subscribe/pro?from=HuggingChat"
					target="_blank"
					rel="noopener noreferrer"
					class="ml-auto flex h-[20px] items-center gap-1 px-1.5 py-0.5 text-xs text-gray-500 dark:text-gray-400"
				>
					<IconPro />
					Get PRO
				</a>
			{:else if publicConfig.isHuggingChat && $isPro === true}
				<span
					class="ml-auto flex h-[20px] items-center gap-1 px-1.5 py-0.5 text-xs text-gray-500 dark:text-gray-400"
				>
					<IconPro />
					PRO
				</span>
			{/if}
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

<DragOverlay />
