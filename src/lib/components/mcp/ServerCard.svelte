<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import type { MCPServer } from "$lib/types/Tool";
	import { toggleServer, healthCheckServer, deleteCustomServer } from "$lib/stores/mcpServers";
	import { mcpOAuthTokens, mcpOAuthConfigs, reloadFromStorage } from "$lib/stores/mcpOAuthTokens";
	import { discoverOAuthMetadata, startOAuthFlow } from "$lib/services/mcpOAuthService";
	import IconCheckmark from "~icons/carbon/checkmark-filled";
	import IconWarning from "~icons/carbon/warning-filled";
	import IconPending from "~icons/carbon/pending-filled";
	import IconRefresh from "~icons/carbon/renew";
	import IconTrash from "~icons/carbon/trash-can";
	import LucideHammer from "~icons/lucide/hammer";
	import IconSettings from "~icons/carbon/settings";
	import IconLocked from "~icons/carbon/locked";
	import Switch from "$lib/components/Switch.svelte";
	import { getMcpServerFaviconUrl } from "$lib/utils/favicon";

	interface Props {
		server: MCPServer;
		isSelected: boolean;
	}

	let { server, isSelected }: Props = $props();

	let isLoadingHealth = $state(false);
	let isReauthenticating = $state(false);
	let oauthPopup = $state<Window | null>(null);
	let popupPollTimer: ReturnType<typeof setInterval> | undefined;
	let oauthError = $state<string | null>(null);

	// Show a quick-access link ONLY for the exact HF MCP login endpoint
	import { isStrictHfMcpLogin as isStrictHfMcpLoginUrl } from "$lib/utils/hf";
	const isHfMcp = $derived.by(() => isStrictHfMcpLoginUrl(server.url));

	const tokenStatus = $derived.by(() => {
		const tokens = $mcpOAuthTokens;
		const configs = $mcpOAuthConfigs;
		const hasToken = tokens.has(server.id);
		const hasConfig = configs.has(server.id);

		if (!server.oauthEnabled && !hasToken && !hasConfig) return "none";

		const token = tokens.get(server.id);
		if (!token) return "missing";
		if (Date.now() > token.expiresAt - 5 * 60 * 1000) return "expired";
		if (Date.now() > token.expiresAt - 10 * 60 * 1000) return "expiring";
		return "valid";
	});

	function startPopupPolling() {
		if (popupPollTimer) {
			clearInterval(popupPollTimer);
		}

		popupPollTimer = setInterval(() => {
			if (oauthPopup?.closed) {
				clearInterval(popupPollTimer);
				popupPollTimer = undefined;
				oauthPopup = null;
				isReauthenticating = false;
			}
		}, 500);
	}

	async function handleReauthenticate() {
		isReauthenticating = true;
		oauthError = null;
		try {
			const metadata = await discoverOAuthMetadata(server.url);
			if (metadata) {
				oauthPopup = await startOAuthFlow(
					server.id,
					server.url,
					server.name,
					metadata,
					window.location.href
				);

				if (oauthPopup) {
					startPopupPolling();
				}
			}
		} catch (err) {
			console.error("Re-authentication failed:", err);
			oauthError = err instanceof Error ? err.message : "Re-authentication failed";
			isReauthenticating = false;
		}
	}

	const statusInfo = $derived.by(() => {
		switch (server.status) {
			case "connected":
				return {
					label: "Connected",
					color: "text-green-600 dark:text-green-400",
					bgColor: "bg-green-100 dark:bg-green-900/20",
					icon: IconCheckmark,
				};
			case "connecting":
				return {
					label: "Connecting...",
					color: "text-blue-600 dark:text-blue-400",
					bgColor: "bg-blue-100 dark:bg-blue-900/20",
					icon: IconPending,
				};
			case "error":
				return {
					label: "Error",
					color: "text-red-600 dark:text-red-400",
					bgColor: "bg-red-100 dark:bg-red-900/20",
					icon: IconWarning,
				};
			case "disconnected":
			default:
				return {
					label: "Unknown",
					color: "text-gray-600 dark:text-gray-400",
					bgColor: "bg-gray-100 dark:bg-gray-700",
					icon: IconPending,
				};
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

	function handleOAuthMessage(event: MessageEvent) {
		if (event.origin !== window.location.origin) return;

		if (event.data?.type === "mcp-oauth-complete" && event.data?.serverId === server.id) {
			if (popupPollTimer) {
				clearInterval(popupPollTimer);
				popupPollTimer = undefined;
			}
			oauthPopup = null;
			isReauthenticating = false;

			if (event.data.success) {
				oauthError = null;
				reloadFromStorage(); // Sync tokens from popup's localStorage writes
				healthCheckServer(server);
			} else {
				oauthError = event.data.error || "Authentication failed";
			}
		}
	}

	onMount(() => {
		window.addEventListener("message", handleOAuthMessage);
	});

	onDestroy(() => {
		window.removeEventListener("message", handleOAuthMessage);
		if (popupPollTimer) {
			clearInterval(popupPollTimer);
		}
	});
</script>

<div
	class="rounded-lg border bg-gradient-to-br transition-colors {isSelected
		? 'border-blue-600/20 bg-blue-50 from-blue-500/5 to-transparent dark:border-blue-700/60 dark:bg-blue-900/10 dark:from-blue-900/20'
		: 'border-gray-200 bg-white from-black/5 dark:border-gray-700 dark:bg-gray-800 dark:from-white/5'}"
>
	<div class="px-4 py-3.5">
		<!-- Header -->
		<div class="mb-3 flex items-start justify-between gap-3">
			<div class="min-w-0 flex-1">
				<div class="mb-0.5 flex items-center gap-2">
					<img
						src={getMcpServerFaviconUrl(server.url)}
						alt=""
						class="size-4 flex-shrink-0 rounded"
					/>
					<h3 class="truncate font-semibold text-gray-900 dark:text-gray-100">
						{server.name}
					</h3>
				</div>
				<p class="truncate text-sm text-gray-600 dark:text-gray-400">
					{server.url}
				</p>
			</div>

			<!-- Enable Switch (function binding per Svelte 5 docs) -->
			<Switch name={`enable-${server.id}`} bind:checked={() => isSelected, setEnabled} />
		</div>

		<!-- Status -->
		{#if server.status}
			<div class="mb-2 flex items-center gap-2">
				<span
					class="inline-flex items-center gap-1 rounded-full {statusInfo.bgColor} py-0.5 pl-1.5 pr-2 text-xs font-medium {statusInfo.color}"
				>
					{#if server.status === "connected"}
						<IconCheckmark class="size-3" />
					{:else if server.status === "connecting"}
						<IconPending class="size-3" />
					{:else if server.status === "error"}
						<IconWarning class="size-3" />
					{:else}
						<IconPending class="size-3" />
					{/if}
					{statusInfo.label}
				</span>

				{#if server.tools && server.tools.length > 0}
					<span class="inline-flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400">
						<LucideHammer class="size-3" />
						{server.tools.length}
						{server.tools.length === 1 ? "tool" : "tools"}
					</span>
				{/if}
			</div>
		{/if}

		<!-- Error Message -->
		{#if server.errorMessage}
			<div class="mb-2 flex items-center gap-2">
				<div
					class="line-clamp-6 break-words rounded bg-red-50 px-2 py-1 text-xs text-red-800 dark:bg-red-900/20 dark:text-red-200"
				>
					{server.errorMessage}
				</div>
			</div>
		{/if}

		<!-- OAuth Error -->
		{#if oauthError}
			<div class="mb-2">
				<div
					class="rounded bg-red-50 px-2 py-1 text-xs text-red-800 dark:bg-red-900/20 dark:text-red-200"
				>
					{oauthError}
				</div>
			</div>
		{/if}

		<!-- OAuth Token Status -->
		{#if tokenStatus === "expired" || tokenStatus === "missing"}
			<div class="mb-2">
				<div class="flex items-center gap-2 rounded bg-amber-50 px-2 py-1.5 dark:bg-amber-900/20">
					<IconLocked class="size-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
					<span class="flex-1 text-xs text-amber-800 dark:text-amber-200">
						Authentication expired
					</span>
					<button
						onclick={handleReauthenticate}
						disabled={isReauthenticating}
						class="rounded bg-amber-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50 dark:bg-amber-500 dark:hover:bg-amber-600"
					>
						{isReauthenticating ? "..." : "Re-authenticate"}
					</button>
				</div>
			</div>
		{:else if tokenStatus === "expiring"}
			<div class="mb-2">
				<div class="flex items-center gap-2 rounded bg-yellow-50 px-2 py-1.5 dark:bg-yellow-900/20">
					<IconWarning class="size-4 flex-shrink-0 text-yellow-600 dark:text-yellow-400" />
					<span class="text-xs text-yellow-800 dark:text-yellow-200"> Token expires soon </span>
				</div>
			</div>
		{/if}

		<!-- Actions -->
		<div class="flex flex-wrap gap-1">
			<button
				onclick={handleHealthCheck}
				disabled={isLoadingHealth}
				class="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-[.29rem] text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
			>
				<IconRefresh class="size-3 {isLoadingHealth ? 'animate-spin' : ''}" />
				Health Check
			</button>

			{#if isHfMcp}
				<a
					href="https://huggingface.co/settings/mcp"
					target="_blank"
					rel="noopener noreferrer"
					class="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-[.29rem] text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
					aria-label="Open Hugging Face MCP settings"
				>
					<IconSettings class="size-3" />
					Settings
				</a>
			{/if}

			{#if server.type === "custom"}
				<button
					onclick={handleDelete}
					class="flex items-center gap-1.5 rounded-lg border border-red-500/15 bg-red-50 px-2.5 py-[.29rem] text-xs font-medium text-red-600 hover:bg-red-100 dark:border-red-500/25 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50"
				>
					<IconTrash class="size-3" />
					Delete
				</button>
			{/if}
		</div>

		<!-- Tools List (Expandable) -->
		{#if server.tools && server.tools.length > 0}
			<details class="mt-3">
				<summary class="cursor-pointer text-xs font-medium text-gray-700 dark:text-gray-300">
					Available Tools ({server.tools.length})
				</summary>
				<ul class="mt-2 space-y-1 text-xs">
					{#each server.tools as tool}
						<li class="text-gray-600 dark:text-gray-400">
							<span class="font-medium text-gray-900 dark:text-gray-100">{tool.name}</span>
							{#if tool.description}
								<span class="text-gray-500 dark:text-gray-500">- {tool.description}</span>
							{/if}
						</li>
					{/each}
				</ul>
			</details>
		{/if}
	</div>
</div>
