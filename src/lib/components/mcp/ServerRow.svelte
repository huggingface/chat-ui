<script lang="ts">
	import type { MCPServer } from "$lib/types/Tool";
	import { toggleServer, healthCheckServer, deleteCustomServer } from "$lib/stores/mcpServers";
	import IconChevronDown from "~icons/carbon/chevron-down";
	import IconRefresh from "~icons/carbon/renew";
	import IconTrash from "~icons/carbon/trash-can";
	import IconSettings from "~icons/carbon/settings";
	import IconWarning from "~icons/carbon/warning-filled";
	import Switch from "$lib/components/Switch.svelte";
	import { getMcpServerFaviconUrl } from "$lib/utils/favicon";
	import { isStrictHfMcpLogin as isStrictHfMcpLoginUrl } from "$lib/utils/hf";

	interface Props {
		server: MCPServer;
		isSelected: boolean;
	}

	let { server, isSelected }: Props = $props();

	let isExpanded = $state(false);
	let isLoadingHealth = $state(false);

	const isHfMcp = $derived.by(() => isStrictHfMcpLoginUrl(server.url));

	const statusDotClass = $derived.by(() => {
		switch (server.status) {
			case "connected":
				return "bg-green-500";
			case "connecting":
				return "bg-blue-500 animate-pulse";
			case "error":
				return "bg-red-500";
			default:
				return "bg-gray-300 dark:bg-gray-500";
		}
	});

	const statusLabel = $derived.by(() => {
		switch (server.status) {
			case "connected":
				return "Connected";
			case "connecting":
				return "Connecting…";
			case "error":
				return "Error";
			default:
				return "Unknown";
		}
	});

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

	function toggleExpand() {
		isExpanded = !isExpanded;
	}
</script>

<div class="border-b border-gray-200 last:border-b-0 dark:border-gray-700">
	<div
		class="flex items-center gap-3 pl-2 pr-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/30"
	>
		<button
			type="button"
			onclick={toggleExpand}
			class="flex min-w-0 flex-1 items-center gap-2.5 py-2.5 text-left"
			aria-expanded={isExpanded}
			aria-label="Toggle details for {server.name}"
		>
			<IconChevronDown
				class="size-3.5 flex-shrink-0 text-gray-400 transition-transform dark:text-gray-500 {isExpanded
					? 'rotate-0'
					: '-rotate-90'}"
			/>
			<img src={getMcpServerFaviconUrl(server.url)} alt="" class="size-4 flex-shrink-0 rounded" />
			<div class="min-w-0 flex-1">
				<div class="flex items-center gap-1.5">
					<span class="truncate text-sm font-medium text-gray-900 dark:text-gray-100"
						>{server.name}</span
					>
					{#if server.errorMessage}
						<IconWarning class="size-3.5 flex-shrink-0 text-red-500" />
					{/if}
				</div>
				<p class="truncate text-xs text-gray-500 dark:text-gray-400">{server.url}</p>
			</div>
		</button>

		<div
			class="flex flex-shrink-0 items-center gap-2 text-xs text-gray-500 dark:text-gray-400 max-sm:hidden"
		>
			<span class="flex items-center gap-1.5">
				<span class="size-1.5 rounded-full {statusDotClass}"></span>
				<span>{statusLabel}</span>
			</span>
			{#if server.tools && server.tools.length > 0}
				<span class="text-gray-300 dark:text-gray-600">·</span>
				<span>{server.tools.length} {server.tools.length === 1 ? "tool" : "tools"}</span>
			{/if}
		</div>

		<div class="flex flex-shrink-0 items-center gap-1.5 sm:hidden">
			<span class="size-1.5 rounded-full {statusDotClass}"></span>
		</div>

		<div class="flex-shrink-0">
			<Switch name={`enable-${server.id}`} size="sm" bind:checked={() => isSelected, setEnabled} />
		</div>
	</div>

	{#if isExpanded}
		<div class="border-t border-gray-100 px-3 py-3 dark:border-gray-700/60 dark:bg-black/10">
			{#if server.errorMessage}
				<div
					class="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-300"
				>
					{server.errorMessage}
				</div>
			{/if}

			<div class="mb-3 flex flex-wrap items-center gap-1.5">
				<button
					onclick={handleHealthCheck}
					disabled={isLoadingHealth}
					class="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
				>
					<IconRefresh class="size-3 {isLoadingHealth ? 'animate-spin' : ''}" />
					Health check
				</button>

				{#if isHfMcp}
					<a
						href="https://huggingface.co/settings/mcp"
						target="_blank"
						rel="noopener noreferrer"
						class="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
						aria-label="Open Hugging Face MCP settings"
					>
						<IconSettings class="size-3" />
						Settings
					</a>
				{/if}

				{#if server.type === "custom"}
					<button
						onclick={handleDelete}
						class="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
					>
						<IconTrash class="size-3" />
						Delete
					</button>
				{/if}
			</div>

			{#if server.tools && server.tools.length > 0}
				<div>
					<p
						class="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400"
					>
						{server.tools.length}
						{server.tools.length === 1 ? "Tool" : "Tools"}
					</p>
					<ul class="space-y-1 text-xs">
						{#each server.tools as tool}
							<li class="text-gray-600 dark:text-gray-400">
								<span class="font-medium text-gray-800 dark:text-gray-200">{tool.name}</span>
								{#if tool.description}
									<span class="text-gray-500 dark:text-gray-500"> — {tool.description}</span>
								{/if}
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>
	{/if}
</div>
