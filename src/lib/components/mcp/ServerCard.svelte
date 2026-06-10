<script lang="ts">
	import type { MCPServer } from "$lib/types/Tool";
	import { toggleServer, healthCheckServer, deleteCustomServer } from "$lib/stores/mcpServers";
	import IconRefresh from "~icons/carbon/renew";
	import IconTrash from "~icons/carbon/trash-can";
	import IconSettings from "~icons/carbon/settings";
	import Switch from "$lib/components/Switch.svelte";
	import { getMcpServerFaviconUrl } from "$lib/utils/favicon";
	// Show a quick-access link ONLY for the exact HF MCP login endpoint
	import { isStrictHfMcpLogin as isStrictHfMcpLoginUrl } from "$lib/utils/hf";

	interface Props {
		server: MCPServer;
		isSelected: boolean;
	}

	let { server, isSelected }: Props = $props();

	let isLoadingHealth = $state(false);
	let showTools = $state(false);
	let faviconFailed = $state(false);

	const isHfMcp = $derived.by(() => isStrictHfMcpLoginUrl(server.url));

	const displayUrl = $derived(server.url.replace(/^https?:\/\//, ""));

	const statusInfo = $derived.by(() => {
		switch (server.status) {
			case "connected":
				return { label: "Connected", dot: "bg-green-500" };
			case "connecting":
				return { label: "Connecting…", dot: "animate-pulse bg-amber-400" };
			case "error":
				return { label: "Connection error", dot: "bg-red-500" };
			case "disconnected":
			default:
				return { label: "Not checked", dot: "bg-gray-300 dark:bg-gray-600" };
		}
	});

	// Switch setter handles enable/disable (simple, idiomatic)
	function setEnabled(v: boolean) {
		if (v === isSelected) return;
		toggleServer(server.id);
		if (v && server.status !== "connected") handleHealthCheck();
	}

	async function handleHealthCheck() {
		isLoadingHealth = true;
		try {
			await healthCheckServer(server);
		} finally {
			isLoadingHealth = false;
		}
	}

	function handleDelete() {
		deleteCustomServer(server.id);
	}
</script>

<div class="px-3.5 py-3">
	<div class="flex items-center gap-3">
		<div class="flex min-w-0 flex-1 items-center gap-2.5 {isSelected ? '' : 'opacity-60'}">
			{#if faviconFailed}
				<div
					class="flex size-5 shrink-0 items-center justify-center rounded bg-gray-100 text-[11px] font-semibold text-gray-500 dark:bg-gray-700 dark:text-gray-400"
				>
					{server.name.charAt(0).toUpperCase()}
				</div>
			{:else}
				<img
					src={getMcpServerFaviconUrl(server.url)}
					alt=""
					class="size-5 shrink-0 rounded"
					onerror={() => (faviconFailed = true)}
				/>
			{/if}
			<div class="min-w-0">
				<div class="flex items-center gap-1.5">
					<h3 class="truncate text-sm font-medium text-gray-800 dark:text-gray-200">
						{server.name}
					</h3>
					<span class="size-1.5 shrink-0 rounded-full {statusInfo.dot}" title={statusInfo.label}
					></span>
				</div>
				<div class="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
					<span class="truncate" title={server.url}>{displayUrl}</span>
					{#if server.tools && server.tools.length > 0}
						<span class="shrink-0">·</span>
						<button
							onclick={() => (showTools = !showTools)}
							class="shrink-0 underline-offset-2 hover:underline"
						>
							{server.tools.length}
							{server.tools.length === 1 ? "tool" : "tools"}
						</button>
					{/if}
				</div>
			</div>
		</div>

		<!-- Actions -->
		<div class="flex shrink-0 items-center gap-0.5">
			<button
				onclick={handleHealthCheck}
				disabled={isLoadingHealth}
				title="Check connection"
				aria-label="Check connection"
				class="btn rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50 dark:hover:bg-gray-700 dark:hover:text-gray-300"
			>
				<IconRefresh class="size-3.5 {isLoadingHealth ? 'animate-spin' : ''}" />
			</button>

			{#if isHfMcp}
				<a
					href="https://huggingface.co/settings/mcp"
					target="_blank"
					rel="noopener noreferrer"
					title="Open Hugging Face MCP settings"
					aria-label="Open Hugging Face MCP settings"
					class="btn rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-300"
				>
					<IconSettings class="size-3.5" />
				</a>
			{/if}

			{#if server.type === "custom"}
				<button
					onclick={handleDelete}
					title="Delete server"
					aria-label="Delete server"
					class="btn rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
				>
					<IconTrash class="size-3.5" />
				</button>
			{/if}

			<div class="ml-1.5 flex items-center">
				<Switch name={`enable-${server.id}`} bind:checked={() => isSelected, setEnabled} />
			</div>
		</div>
	</div>

	<!-- Error Message -->
	{#if server.errorMessage}
		<p class="mt-1.5 line-clamp-3 break-words pl-[30px] text-xs text-red-600 dark:text-red-400">
			{server.errorMessage}
		</p>
	{/if}

	<!-- Tools List -->
	{#if showTools && server.tools && server.tools.length > 0}
		<div class="mt-2 flex flex-wrap gap-1 pl-[30px]">
			{#each server.tools as tool (tool.name)}
				<span
					title={tool.description}
					class="rounded-md bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-gray-700/60 dark:text-gray-300"
				>
					{tool.name}
				</span>
			{/each}
		</div>
	{/if}
</div>
