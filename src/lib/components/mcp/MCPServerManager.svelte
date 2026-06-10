<script lang="ts">
	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";
	import Modal from "$lib/components/Modal.svelte";
	import ServerCard from "./ServerCard.svelte";
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
	import IconAddLarge from "~icons/carbon/add-large";
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
			// After refreshing the list, re-run health checks for all known servers
			const servers = $allMcpServers;
			await Promise.allSettled(servers.map((s) => healthCheckServer(s)));
		} finally {
			isRefreshing = false;
		}
	}
</script>

<Modal width="w-[640px]" {onclose} closeButton>
	<div class="p-6">
		<!-- Header -->
		<div class="mb-5">
			<h2 class="text-lg font-semibold text-gray-800 dark:text-gray-200">
				{#if currentView === "list"}
					MCP Servers
				{:else}
					Add MCP server
				{/if}
			</h2>
			<p class="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
				{#if currentView === "list"}
					Extend {publicConfig.PUBLIC_APP_NAME} with tools from external servers.
				{:else}
					Connect a custom MCP server to {publicConfig.PUBLIC_APP_NAME}.
				{/if}
			</p>
		</div>

		<!-- Content -->
		{#if currentView === "list"}
			<div class="mb-4 flex items-center justify-between gap-3">
				<p class="text-xs text-gray-400 dark:text-gray-500">
					{enabledCount} of {$allMcpServers.length} enabled
				</p>
				<div class="flex items-center gap-1.5">
					<button
						onclick={handleRefresh}
						disabled={isRefreshing}
						title="Refresh servers"
						aria-label="Refresh servers"
						class="btn rounded-lg border border-gray-200 p-1.5 text-gray-500 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
					>
						<IconRefresh class="size-3.5 {isRefreshing ? 'animate-spin' : ''}" />
					</button>
					<button
						onclick={() => (currentView = "add")}
						class="btn gap-1 rounded-lg bg-blue-600 py-1.5 pl-2 pr-2.5 text-xs font-medium text-white hover:bg-blue-700"
					>
						<IconAddLarge class="size-3" />
						Add server
					</button>
				</div>
			</div>

			<div class="space-y-5">
				<!-- Base Servers -->
				{#if baseServers.length > 0}
					<section>
						<h3
							class="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500"
						>
							Base servers
						</h3>
						<div
							class="divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-700/60 dark:border-gray-700"
						>
							{#each baseServers as server (server.id)}
								<ServerCard {server} isSelected={$selectedServerIds.has(server.id)} />
							{/each}
						</div>
					</section>
				{/if}

				<!-- Custom Servers -->
				<section>
					<h3
						class="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500"
					>
						Custom servers
					</h3>
					{#if customServers.length === 0}
						<div
							class="flex items-center justify-center gap-1 rounded-xl border border-dashed border-gray-300 px-4 py-5 text-sm dark:border-gray-600"
						>
							<span class="text-gray-400 dark:text-gray-500">No custom servers yet.</span>
							<button
								onclick={() => (currentView = "add")}
								class="font-medium text-blue-600 hover:underline dark:text-blue-400"
							>
								Add one
							</button>
						</div>
					{:else}
						<div
							class="divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-700/60 dark:border-gray-700"
						>
							{#each customServers as server (server.id)}
								<ServerCard {server} isSelected={$selectedServerIds.has(server.id)} />
							{/each}
						</div>
					{/if}
				</section>

				<p class="text-xs leading-relaxed text-gray-400 dark:text-gray-500">
					Tools from enabled servers become available in chat. Only connect to servers you trust.
				</p>
			</div>
		{:else if currentView === "add"}
			<AddServerForm onsubmit={handleAddServer} oncancel={handleCancel} />
		{/if}
	</div>
</Modal>
