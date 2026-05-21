<script lang="ts">
	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";
	import Modal from "$lib/components/Modal.svelte";
	import ServerRow from "./ServerRow.svelte";
	import AddServerForm from "./AddServerForm.svelte";
	import {
		allMcpServers,
		selectedServerIds,
		enabledServersCount,
		addCustomServer,
		refreshMcpServers,
		healthCheckServer,
	} from "$lib/stores/mcpServers";
	import type { KeyValuePair } from "$lib/types/Tool";
	import IconAdd from "~icons/carbon/add";
	import IconRefresh from "~icons/carbon/renew";

	const publicConfig = usePublicConfig();

	interface Props {
		onclose: () => void;
	}

	let { onclose }: Props = $props();

	type View = "list" | "add";
	let currentView = $state<View>("list");
	let isRefreshing = $state(false);

	const baseServers = $derived($allMcpServers.filter((s) => s.type === "base"));
	const customServers = $derived($allMcpServers.filter((s) => s.type === "custom"));
	const enabledCount = $derived($enabledServersCount);

	function handleAddServer(serverData: { name: string; url: string; headers?: KeyValuePair[] }) {
		addCustomServer(serverData);
		currentView = "list";
	}

	function handleCancel() {
		currentView = "list";
	}

	async function handleRefresh() {
		if (isRefreshing) return;
		isRefreshing = true;
		try {
			await refreshMcpServers();
			const servers = $allMcpServers;
			await Promise.allSettled(servers.map((s) => healthCheckServer(s)));
		} finally {
			isRefreshing = false;
		}
	}
</script>

<Modal width={currentView === "list" ? "w-[680px]" : "w-[600px]"} {onclose} closeButton>
	<div class="p-6">
		<div class="mb-5">
			<h2 class="mb-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
				{#if currentView === "list"}
					MCP Servers
				{:else}
					Add MCP server
				{/if}
			</h2>
			<p class="text-sm text-gray-500 dark:text-gray-400">
				{#if currentView === "list"}
					Extend {publicConfig.PUBLIC_APP_NAME} with external tools.
				{:else}
					Add a custom MCP server to {publicConfig.PUBLIC_APP_NAME}.
				{/if}
			</p>
		</div>

		{#if currentView === "list"}
			<div
				class="mb-4 flex items-center justify-between border-b border-gray-200 pb-3 dark:border-gray-700"
			>
				<p class="text-xs text-gray-500 dark:text-gray-400">
					<span class="font-medium text-gray-700 dark:text-gray-300">{$allMcpServers.length}</span>
					{$allMcpServers.length === 1 ? "server" : "servers"} ·
					<span class="font-medium text-gray-700 dark:text-gray-300">{enabledCount}</span> enabled
				</p>
				<div class="flex items-center gap-1">
					<button
						onclick={handleRefresh}
						disabled={isRefreshing}
						class="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-700"
					>
						<IconRefresh class="size-3.5 {isRefreshing ? 'animate-spin' : ''}" />
						{isRefreshing ? "Refreshing…" : "Refresh"}
					</button>
					<button
						onclick={() => (currentView = "add")}
						class="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
					>
						<IconAdd class="size-3.5" />
						Add server
					</button>
				</div>
			</div>

			{#if baseServers.length > 0}
				<div class="mb-5">
					<div
						class="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400"
					>
						Base
					</div>
					<div class="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
						{#each baseServers as server (server.id)}
							<ServerRow {server} isSelected={$selectedServerIds.has(server.id)} />
						{/each}
					</div>
				</div>
			{/if}

			<div class="mb-5">
				<div
					class="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400"
				>
					Custom
				</div>
				{#if customServers.length === 0}
					<button
						onclick={() => (currentView = "add")}
						class="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 px-4 py-5 text-sm text-gray-500 transition-colors hover:border-gray-400 hover:bg-gray-50 hover:text-gray-700 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:bg-gray-700/30 dark:hover:text-gray-300"
					>
						<IconAdd class="size-4" />
						Add a custom server
					</button>
				{:else}
					<div class="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
						{#each customServers as server (server.id)}
							<ServerRow {server} isSelected={$selectedServerIds.has(server.id)} />
						{/each}
					</div>
				{/if}
			</div>

			<p class="text-xs text-gray-500 dark:text-gray-400">
				Only enable servers you trust — they receive your messages and can act on your behalf.
			</p>
		{:else if currentView === "add"}
			<AddServerForm onsubmit={handleAddServer} oncancel={handleCancel} />
		{/if}
	</div>
</Modal>
