<script lang="ts">
	import { onMount } from "svelte";
	import type { MCPOAuthState, MCPServer } from "$lib/types/Tool";
	import {
		toggleServer,
		healthCheckServer,
		deleteCustomServer,
		disconnectServerOAuth,
	} from "$lib/stores/mcpServers";
	import IconCheckmark from "~icons/carbon/checkmark-filled";
	import IconWarning from "~icons/carbon/warning-filled";
	import IconPending from "~icons/carbon/pending-filled";
	import IconRefresh from "~icons/carbon/renew";
	import IconTrash from "~icons/carbon/trash-can";
	import IconLock from "~icons/carbon/locked";
	import LucideHammer from "~icons/lucide/hammer";
	import LucideShieldCheck from "~icons/lucide/shield-check";
	import IconSettings from "~icons/carbon/settings";
	import Switch from "$lib/components/Switch.svelte";
	import { getMcpServerFaviconUrl } from "$lib/utils/favicon";

	interface Props {
		server: MCPServer;
		isSelected: boolean;
		onreauthorize?: (detail: { serverId: string; serverUrl: string; oauth: MCPOAuthState }) => void;
	}

	let { server, isSelected, onreauthorize }: Props = $props();

	let isLoadingHealth = $state(false);

	// Reactive wall-clock tick so the `Authorized · expires in …` pill flips to
	// `Authorization required` (and the Authorize button appears) as time passes
	// while the modal is open. `Date.now()` alone is not a tracked reactive
	// source in Svelte 5 — derivations that read it are frozen at first compute.
	let now = $state(Date.now());
	onMount(() => {
		const id = setInterval(() => (now = Date.now()), 30_000);
		return () => clearInterval(id);
	});

	// Show a quick-access link ONLY for the exact HF MCP login endpoint
	import { isStrictHfMcpLogin as isStrictHfMcpLoginUrl } from "$lib/utils/hf";
	const isHfMcp = $derived.by(() => isStrictHfMcpLoginUrl(server.url));

	const oauthAuthorized = $derived(
		Boolean(
			server.oauth?.tokens?.access_token &&
				(!server.oauth.tokens.expires_at || server.oauth.tokens.expires_at > now)
		)
	);
	const oauthNeedsAuth = $derived(Boolean(server.oauth) && !oauthAuthorized);
	const issuerHost = $derived.by(() => {
		try {
			return server.oauth?.asMetadata?.issuer ? new URL(server.oauth.asMetadata.issuer).host : "";
		} catch {
			return server.oauth?.asMetadata?.issuer ?? "";
		}
	});
	const expiresInLabel = $derived.by(() => {
		const exp = server.oauth?.tokens?.expires_at;
		if (!exp) return null;
		const ms = exp - now;
		if (ms <= 0) return "expired";
		if (ms < 60_000) return "expires in <1m";
		const minutes = Math.ceil(ms / 60_000);
		if (minutes < 60) return `expires in ${minutes}m`;
		const hours = Math.ceil(minutes / 60);
		if (hours < 24) return `expires in ${hours}h`;
		const days = Math.ceil(hours / 24);
		return `expires in ${days}d`;
	});

	function handleReauthorize() {
		if (!server.oauth || !onreauthorize) return;
		onreauthorize({ serverId: server.id, serverUrl: server.url, oauth: server.oauth });
	}

	async function handleDisconnect() {
		await disconnectServerOAuth(server.id);
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
			<div class="mb-2 flex flex-wrap items-center gap-2">
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

				{#if oauthAuthorized}
					<span
						class="inline-flex items-center gap-1 rounded-full bg-green-100 py-0.5 pl-1.5 pr-2 text-xs font-medium text-green-600 dark:bg-green-900/20 dark:text-green-400"
						title={issuerHost ? `OAuth via ${issuerHost}` : "OAuth-authorized"}
					>
						<LucideShieldCheck class="size-3" />
						Authorized{expiresInLabel ? ` · ${expiresInLabel}` : ""}
					</span>
				{:else if oauthNeedsAuth}
					<span
						class="inline-flex items-center gap-1 rounded-full bg-amber-50 py-0.5 pl-1.5 pr-2 text-xs font-medium text-amber-700 dark:bg-amber-900/20 dark:text-amber-300"
					>
						<IconLock class="size-3" />
						Authorization required
					</span>
				{/if}

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

		<!-- Actions -->
		<div class="flex flex-wrap gap-1">
			{#if oauthNeedsAuth}
				<button
					onclick={handleReauthorize}
					class="flex items-center gap-1.5 rounded-lg bg-blue-600 px-2.5 py-[.29rem] text-xs font-medium text-white hover:bg-blue-700"
				>
					<LucideShieldCheck class="size-3" />
					Authorize
				</button>
			{/if}

			<button
				onclick={handleHealthCheck}
				disabled={isLoadingHealth}
				class="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-[.29rem] text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
			>
				<IconRefresh class="size-3 {isLoadingHealth ? 'animate-spin' : ''}" />
				Health Check
			</button>

			{#if oauthAuthorized}
				<button
					onclick={handleDisconnect}
					class="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-[.29rem] text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
				>
					<IconLock class="size-3" />
					Disconnect
				</button>
			{/if}

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
