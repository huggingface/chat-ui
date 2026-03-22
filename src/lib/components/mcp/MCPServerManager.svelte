<script lang="ts">
	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";
	import Modal from "$lib/components/Modal.svelte";
	import ServerCard from "./ServerCard.svelte";
	import AddServerForm from "./AddServerForm.svelte";
	import MCPServerSearch from "./MCPServerSearch.svelte";
	import {
		allMcpServers,
		selectedServerIds,
		enabledServersCount,
		addCustomServer,
		updateCustomServer,
		refreshMcpServers,
		healthCheckServer,
	} from "$lib/stores/mcpServers";
	import type { KeyValuePair, MCPRegistryEntry, MCPServer } from "$lib/types/Tool";
	import IconAddLarge from "~icons/carbon/add-large";
	import IconRefresh from "~icons/carbon/renew";
	import LucideHammer from "~icons/lucide/hammer";
	import IconMCP from "$lib/components/icons/IconMCP.svelte";

	const publicConfig = usePublicConfig();

	interface Props {
		onclose: () => void;
	}

	let { onclose }: Props = $props();

	type View = "list" | "add";
	type AddTab = "search" | "manual";

	let currentView = $state<View>("list");
	let addTab = $state<AddTab>("search");
	let isRefreshing = $state(false);

	let prefillName = $state("");
	let prefillUrl = $state("");
	let prefillDescription = $state("");
	let prefillHeaders = $state<KeyValuePair[]>([]);
	let editingServer = $state<MCPServer | null>(null);

	const baseServers = $derived($allMcpServers.filter((s) => s.type === "base"));
	const customServers = $derived($allMcpServers.filter((s) => s.type === "custom"));
	const enabledCount = $derived($enabledServersCount);

	function handleAddServer(serverData: { name: string; url: string; headers?: KeyValuePair[] }) {
		if (editingServer) {
			updateCustomServer(editingServer.id, serverData);
		} else {
			addCustomServer(serverData);
		}
		resetAddState();
		currentView = "list";
	}

	function resetAddState() {
		prefillName = "";
		prefillUrl = "";
		prefillDescription = "";
		prefillHeaders = [];
		editingServer = null;
		addTab = "search";
	}

	function handleCancel() {
		resetAddState();
		currentView = "list";
	}

	function handleEditServer(server: MCPServer) {
		editingServer = server;
		prefillName = server.name;
		prefillUrl = server.url;
		prefillDescription = "";
		prefillHeaders = server.headers ?? [];
		addTab = "manual";
		currentView = "add";
	}

	function handleRegistryAdd(entry: MCPRegistryEntry) {
		prefillName = entry.title ?? entry.name;
		prefillUrl = entry.url;
		prefillDescription = entry.description;
		prefillHeaders = (entry.requiredHeaders ?? []).map((h) => ({
			key: h.name,
			value: "",
			description: h.description,
			required: true,
		}));
		addTab = "manual";
	}

	function switchToAdd() {
		resetAddState();
		currentView = "add";
	}

	async function handleRefresh() {
		if (isRefreshing) return;
		isRefreshing = true;
		try {
			await refreshMcpServers();
			// After refreshing the list, re-run health checks for all known servers
			const servers = $allMcpServers;
			await Promise.allSettled(servers.map((s) => healthCheckServer(s)));
		} finally {
			isRefreshing = false;
		}
	}
</script>

<Modal width={currentView === "list" ? "w-[800px]" : "w-[600px]"} {onclose} closeButton>
	<div class="p-6">
		<!-- Header -->
		<div class="mb-6">
			<h2 class="mb-1 text-xl font-semibold text-gray-900 dark:text-gray-200">
				{#if currentView === "list"}
					MCP Servers
				{:else if editingServer}
					Edit MCP server
				{:else}
					Add MCP server
				{/if}
			</h2>
			<p class="text-sm text-gray-600 dark:text-gray-400">
				{#if currentView === "list"}
					Manage MCP servers to extend {publicConfig.PUBLIC_APP_NAME} with external tools.
				{:else if editingServer}
					Update the configuration for {editingServer.name}.
				{:else}
					Search the MCP Registry or add a custom server URL.
				{/if}
			</p>
		</div>

		<!-- Content -->
		{#if currentView === "list"}
			<div
				class="mb-6 flex justify-between rounded-lg p-4 max-sm:flex-col max-sm:gap-4 sm:items-center {!enabledCount
					? 'bg-gray-100 dark:bg-white/5'
					: 'bg-blue-50 dark:bg-blue-900/10'}"
			>
				<div class="flex items-center gap-3">
					<div
						class="flex size-10 items-center justify-center rounded-xl bg-blue-500/10"
						class:grayscale={!enabledCount}
					>
						<IconMCP classNames="size-8 text-blue-600 dark:text-blue-500" />
					</div>
					<div>
						<p class="text-sm font-semibold text-gray-900 dark:text-gray-100">
							{$allMcpServers.length}
							{$allMcpServers.length > 1 ? "servers" : "server"} configured
						</p>
						<p class="text-xs text-gray-600 dark:text-gray-400">
							{enabledCount} enabled
						</p>
					</div>
				</div>

				<div class="flex gap-2">
					{#if $allMcpServers.length > 0}
						<button
							onclick={handleRefresh}
							disabled={isRefreshing}
							class="btn gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
						>
							<IconRefresh class="size-4 {isRefreshing ? 'animate-spin' : ''}" />
							{isRefreshing ? "Refreshing…" : "Refresh"}
						</button>
					{/if}
					<button
						onclick={switchToAdd}
						class="btn flex items-center gap-0.5 rounded-lg bg-blue-600 py-1.5 pl-2 pr-3 text-sm font-medium text-white hover:bg-blue-700"
					>
						<IconAddLarge class="size-4" />
						Add Server
					</button>
				</div>
			</div>
			<div class="space-y-5">
				<!-- Base Servers -->
				{#if baseServers.length > 0}
					<div>
						<h3 class="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">
							Base Servers ({baseServers.length})
						</h3>
						<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
							{#each baseServers as server (server.id)}
								<ServerCard {server} isSelected={$selectedServerIds.has(server.id)} />
							{/each}
						</div>
					</div>
				{/if}

				<!-- Custom Servers -->
				<div>
					<h3 class="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">
						Custom Servers ({customServers.length})
					</h3>
					{#if customServers.length === 0}
						<div
							class="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 p-8 dark:border-gray-700"
						>
							<LucideHammer class="mb-3 size-12 text-gray-400" />
							<p class="mb-1 text-sm font-medium text-gray-900 dark:text-gray-100">
								No custom servers yet
							</p>
							<p class="mb-4 text-xs text-gray-600 dark:text-gray-400">
								Add your own MCP servers with custom tools
							</p>
							<button
								onclick={switchToAdd}
								class="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
							>
								<IconAddLarge class="size-4" />
								Add Your First Server
							</button>
						</div>
					{:else}
						<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
							{#each customServers as server (server.id)}
								<ServerCard
									{server}
									isSelected={$selectedServerIds.has(server.id)}
									onedit={handleEditServer}
								/>
							{/each}
						</div>
					{/if}
				</div>

				<!-- Help Text -->
				<div class="rounded-lg bg-gray-50 p-4 dark:bg-gray-700">
					<h4 class="mb-2 text-sm font-medium text-gray-900 dark:text-gray-100">💡 Quick Tips</h4>
					<ul class="space-y-1 text-xs text-gray-600 dark:text-gray-400">
						<li>• Only connect to servers you trust</li>
						<li>• Enable servers to make their tools available in chat</li>
						<li>• Use the Health Check button to verify server connectivity</li>
						<li>• You can add HTTP headers for authentication when required</li>
					</ul>
				</div>
			</div>
		{:else if currentView === "add"}
			<!-- Tabs -->
			<div class="mb-4 flex border-b border-gray-200 dark:border-gray-700">
				<button
					onclick={() => (addTab = "search")}
					class="border-b-2 px-4 py-2 text-sm font-medium transition-colors {addTab === 'search'
						? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
						: 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'}"
				>
					Search
				</button>
				<button
					onclick={() => (addTab = "manual")}
					class="border-b-2 px-4 py-2 text-sm font-medium transition-colors {addTab === 'manual'
						? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
						: 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'}"
				>
					Add
				</button>
			</div>

			{#if addTab === "search"}
				<MCPServerSearch existingServers={$allMcpServers} onadd={handleRegistryAdd} />
				<div class="mt-3 flex justify-start">
					<button
						onclick={handleCancel}
						class="rounded-lg bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
					>
						Cancel
					</button>
				</div>
			{:else}
				<AddServerForm
					onsubmit={handleAddServer}
					oncancel={handleCancel}
					initialName={prefillName}
					initialUrl={prefillUrl}
					initialDescription={prefillDescription}
					initialHeaders={prefillHeaders}
					submitLabel={editingServer ? "Save Changes" : undefined}
				/>
			{/if}
		{/if}
	</div>
</Modal>
