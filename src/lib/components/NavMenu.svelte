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
	import NavProjectItem from "./NavProjectItem.svelte";
	import ProjectModal from "./ProjectModal.svelte";
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
	import CarbonAdd from "~icons/carbon/add";
	import CarbonChevronLeft from "~icons/carbon/chevron-left";

	const publicConfig = usePublicConfig();
	const client = useAPIClient();

	interface ProjectSidebar {
		id: string;
		name: string;
		description?: string;
		preprompt?: string;
		modelId?: string;
		updatedAt: Date;
		conversationCount: number;
	}

	interface Props {
		conversations: ConvSidebar[];
		projects?: ProjectSidebar[];
		user: LayoutData["user"];
		p?: number;
		activeProjectId?: string | null;
		ondeleteConversation?: (id: string) => void;
		oneditConversationTitle?: (payload: { id: string; title: string }) => void;
		onactiveProjectChange?: (id: string | null) => void;
		onprojectsChange?: (projects: ProjectSidebar[]) => void;
	}

	let {
		conversations = $bindable(),
		projects = $bindable([]),
		user,
		p = $bindable(0),
		activeProjectId = $bindable(null),
		ondeleteConversation,
		oneditConversationTitle,
		onactiveProjectChange,
		onprojectsChange,
	}: Props = $props();

	let hasMore = $state(true);
	let showProjectModal = $state(false);
	let editingProject: ProjectSidebar | undefined = $state();

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

	let displayedConversations = $derived(
		activeProjectId ? conversations.filter((c) => c.projectId === activeProjectId) : conversations
	);

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
		const query: { p: number; projectId?: string } = { p };
		if (activeProjectId) query.projectId = activeProjectId;

		const newConvs = await client.conversations
			.get({ query })
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

	function selectProject(id: string) {
		if (activeProjectId === id) {
			activeProjectId = null;
		} else {
			activeProjectId = id;
		}
		// Reset pagination when switching
		p = 0;
		hasMore = true;
		onactiveProjectChange?.(activeProjectId);
	}

	async function createProject(data: {
		name: string;
		description?: string;
		preprompt?: string;
		modelId?: string;
	}) {
		try {
			const res = await client.projects.post(data).then(handleResponse);
			const newProject: ProjectSidebar = {
				id: (res as { project: { _id: { toString(): string } } }).project._id.toString(),
				name: data.name,
				description: data.description,
				preprompt: data.preprompt,
				modelId: data.modelId,
				updatedAt: new Date(),
				conversationCount: 0,
			};
			projects = [newProject, ...projects];
			onprojectsChange?.(projects);
		} catch (err) {
			console.error("Failed to create project:", err);
		}
	}

	async function updateProject(
		id: string,
		data: { name: string; description?: string; preprompt?: string; modelId?: string }
	) {
		try {
			await client.projects({ id }).patch(data).then(handleResponse);
			projects = projects.map((p) => (p.id === id ? { ...p, ...data, updatedAt: new Date() } : p));
			onprojectsChange?.(projects);
		} catch (err) {
			console.error("Failed to update project:", err);
		}
	}

	async function deleteProject(id: string) {
		try {
			await client.projects({ id }).delete().then(handleResponse);
			projects = projects.filter((p) => p.id !== id);
			if (activeProjectId === id) {
				activeProjectId = null;
				onactiveProjectChange?.(null);
			}
			// Unset projectId on conversations client-side
			conversations = conversations.map((c) =>
				c.projectId === id ? { ...c, projectId: undefined } : c
			);
			onprojectsChange?.(projects);
		} catch (err) {
			console.error("Failed to delete project:", err);
		}
	}

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
	class="sticky top-0 flex flex-none touch-none items-center justify-between px-1.5 py-0"
	class:py-3.5={publicConfig.PUBLIC_SHOW_NAV_LOGO === "true"}
	style={publicConfig.PUBLIC_SHOW_NAV_LOGO === "true" ? "padding-top: 0.875rem;" : ""}
>
	{#if publicConfig.PUBLIC_SHOW_NAV_LOGO === "true"}
		<a
			class="flex select-none items-center rounded-xl text-lg font-semibold"
			href="{publicConfig.PUBLIC_ORIGIN}{base}/"
		>
			<Logo classNames="dark:invert mr-[2px]" variant="nav" />
			{publicConfig.PUBLIC_APP_NAV_NAME || publicConfig.PUBLIC_APP_NAME}
		</a>
	{:else}
		<span></span>
	{/if}
	<a
		href={`${base}/`}
		onclick={handleNewChatClick}
		class="flex rounded-lg border bg-white px-2 py-0.5 text-center shadow-sm hover:shadow-none dark:border-gray-600 dark:bg-gray-700 sm:text-smd"
		title="Ctrl/Cmd + Shift + O"
		style={publicConfig.PUBLIC_SHOW_NAV_LOGO === "true"
			? ""
			: `
			transform: translateY(7px); margin-bottom: -30px;
			margin-right: 10px;
			box-shadow: 0 6px 24px 0 rgba(40,90,105,0.26), 0 5px 8px 0 rgba(255,255,255,0.48) inset, 0 0 12px 0 rgba(255,255,255,0.20);
			border: 1.5px solid rgba(122, 159, 215, 0.4);
			background: transparent;
			backdrop-filter: blur(1px) saturate(80%);
			-webkit-backdrop-filter: blur(1px) saturate(80%);
			color: #555;
			padding: 4px 8px;
			font-size: 0.8rem;
			font-weight: 500;
			overflow: hidden;
			position: relative;
			transition: box-shadow 0.18s, background 0.18s;
		`}
	>
		New Chat
	</a>
</div>

<div
	class="scrollbar-custom flex touch-pan-y flex-col gap-1 overflow-y-auto rounded-r-xl border border-l-0 border-gray-100 from-gray-50 px-3 pb-3 pt-2 text-[.9rem] dark:border-transparent dark:from-gray-800/30 max-sm:bg-gradient-to-t md:bg-gradient-to-l"
	style={publicConfig.PUBLIC_SHOW_NAV_LOGO === "true"
		? ""
		: "background: linear-gradient(190deg, rgba(30,30,255,0.1) 2%, rgba(0,100,255,0) 6%)"}
>
	{#if projects.length > 0 || activeProjectId}
		<div class="flex flex-col gap-0.5 pb-1">
			{#if activeProjectId}
				<button
					type="button"
					class="flex h-[2.15rem] items-center gap-1 rounded-lg pl-2 pr-2 text-sm text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
					onclick={() => selectProject(activeProjectId ?? "")}
				>
					<CarbonChevronLeft class="text-xs" />
					All Chats
				</button>
			{:else}
				<div class="flex items-center justify-between pl-0.5 pr-1">
					<h4 class="mt-1 text-sm text-gray-400 dark:text-gray-500" style="margin: 5px 0px 5px;">
						Projects
					</h4>
					<button
						type="button"
						class="flex h-5 w-5 items-center justify-center rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
						title="Create project"
						onclick={() => {
							if (requireAuthUser()) return;
							editingProject = undefined;
							showProjectModal = true;
						}}
					>
						<CarbonAdd class="text-xs" />
					</button>
				</div>
				{#each projects as project}
					<NavProjectItem
						{project}
						isActive={activeProjectId === project.id}
						onclick={(id) => selectProject(id)}
						onedit={(id) => {
							editingProject = projects.find((p) => p.id === id);
							showProjectModal = true;
						}}
						ondelete={(id) => deleteProject(id)}
					/>
				{/each}
			{/if}
		</div>
	{/if}

	<div class="flex flex-col gap-0.5">
		{#each Object.entries(groupedConversations) as [group, convs]}
			{#if convs.length}
				<h4
					class="mb-1.5 mt-4 pl-0.5 text-sm text-gray-400 first:mt-0 dark:text-gray-500"
					style="margin: 5px 0px 10px;"
				>
					{titles[group]}
				</h4>

				{#each convs as conv}
					<NavConversationItem {conv} {oneditConversationTitle} {ondeleteConversation} />
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
			class="group flex items-center gap-1.5 rounded-lg pl-2.5 pr-2 hover:bg-gray-100 dark:hover:bg-gray-700"
		>
			<span
				class="flex h-9 flex-none shrink items-center gap-1.5 truncate pr-2 text-gray-500 dark:text-gray-400"
				>{user?.username || user?.email}</span
			>

			{#if user?.avatarUrl}
				<img
					src={user.avatarUrl}
					class="ml-auto size-4 rounded-full border bg-gray-500 dark:border-white/40"
					alt=""
				/>
			{:else}
				<div class="ml-auto size-4 rounded-full border bg-gray-500 dark:border-white/40"></div>
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

	<!-- {#if user?.username || user?.email}
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
	{/if} -->

	<!-- <span class="flex gap-1">
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
	</span> -->
</div>

{#if showMcpModal}
	<MCPServerManager onclose={() => (showMcpModal = false)} />
{/if}

{#if showProjectModal}
	<ProjectModal
		open={showProjectModal}
		initial={editingProject
			? {
					name: editingProject.name,
					description: editingProject.description,
					preprompt: editingProject.preprompt,
					modelId: editingProject.modelId,
				}
			: undefined}
		projectId={editingProject?.id}
		onclose={() => {
			showProjectModal = false;
			editingProject = undefined;
		}}
		onsave={(data) => {
			if (editingProject) {
				updateProject(editingProject.id, data);
			} else {
				createProject(data);
			}
			showProjectModal = false;
			editingProject = undefined;
		}}
	/>
{/if}
