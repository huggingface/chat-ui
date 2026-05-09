<script lang="ts">
	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";
	import Modal from "$lib/components/Modal.svelte";
	import ServerCard from "./ServerCard.svelte";
	import AddServerForm from "./AddServerForm.svelte";
	import AuthorizeStep from "./AuthorizeStep.svelte";
	import {
		allMcpServers,
		selectedServerIds,
		enabledServersCount,
		addCustomServer,
		refreshMcpServers,
		healthCheckServer,
		setServerOAuth,
		setServerTokens,
		toggleServer,
	} from "$lib/stores/mcpServers";
	import type { KeyValuePair, MCPClientInformation, MCPOAuthState } from "$lib/types/Tool";
	import type { DiscoveryResponse, OAuthCallbackPayload } from "$lib/utils/mcpOAuth";
	import { error } from "$lib/stores/errors";
	import IconAddLarge from "~icons/carbon/add-large";
	import IconRefresh from "~icons/carbon/renew";
	import LucideHammer from "~icons/lucide/hammer";
	import IconMCP from "$lib/components/icons/IconMCP.svelte";

	const publicConfig = usePublicConfig();

	interface Props {
		onclose: () => void;
	}

	let { onclose }: Props = $props();

	type View = "list" | "add" | "authorize";
	let currentView = $state<View>("list");
	let isRefreshing = $state(false);
	let pendingAuth = $state<{
		serverId: string;
		serverUrl: string;
		discovery: DiscoveryResponse;
	} | null>(null);

	const baseServers = $derived($allMcpServers.filter((s) => s.type === "base"));
	const customServers = $derived($allMcpServers.filter((s) => s.type === "custom"));
	const enabledCount = $derived($enabledServersCount);

	function handleAddServer(serverData: {
		name: string;
		url: string;
		headers?: KeyValuePair[];
		discovery?: DiscoveryResponse;
	}) {
		// Save a partial oauth state on add (asMetadata + resource) even when DCR
		// produced no clientInfo — the manual-client-id flow inside AuthorizeStep
		// will fill it in via handleAuthorized below. Without this, setServerTokens
		// would refuse to persist tokens later because s.oauth would be undefined.
		const oauth: MCPOAuthState | undefined =
			serverData.discovery?.requiresAuth &&
			serverData.discovery.asMetadata &&
			serverData.discovery.resource
				? {
						resource: serverData.discovery.resource,
						asMetadata: serverData.discovery.asMetadata,
						resourceMetadataUrl: serverData.discovery.resourceMetadataUrl,
						clientInfo: serverData.discovery.clientInfo ?? {
							client_id: "",
							redirect_uris: [],
						},
						clientWasManuallyEntered: !serverData.discovery.supportsDcr,
					}
				: undefined;
		const id = addCustomServer({
			name: serverData.name,
			url: serverData.url,
			headers: serverData.headers,
			oauth,
			authRequired: !!oauth,
		});
		// Route to the authorize step only when we built a usable oauth state.
		// If `requiresAuth` came back true but `asMetadata` / `resource` were
		// missing (partial discovery), we'd otherwise route to AuthorizeStep and
		// then `handleAuthorized` would silently bail — leaving the user with a
		// permanently-broken half-state and no UI signal.
		if (oauth && serverData.discovery) {
			pendingAuth = {
				serverId: id,
				serverUrl: serverData.url,
				discovery: serverData.discovery,
			};
			currentView = "authorize";
		} else if (serverData.discovery?.requiresAuth) {
			// Discovery said "needs auth" but we don't have enough metadata to
			// drive the dance. Tell the user explicitly instead of silently adding
			// a broken server.
			currentView = "list";
			$error = `${serverData.url} requires authorization but its OAuth metadata could not be loaded. Try Health Check or contact the server admin.`;
		} else {
			// Non-OAuth server: just close the form. The user flips the Switch on
			// the card to enable it (matches pre-PR behavior).
			currentView = "list";
		}
	}

	function handleAuthorized(payload: OAuthCallbackPayload, clientInfo: MCPClientInformation) {
		if (!pendingAuth || !payload.ok || !payload.tokens) return;
		const { asMetadata, resource, resourceMetadataUrl, supportsDcr } = pendingAuth.discovery;
		if (!asMetadata || !resource) return;
		const serverId = pendingAuth.serverId;
		// Persist the final clientInfo (auto-registered or manually entered) so
		// future refresh / revoke calls don't lose it. Then write the tokens.
		setServerOAuth(serverId, {
			resource,
			asMetadata,
			resourceMetadataUrl,
			clientInfo,
			clientWasManuallyEntered: !supportsDcr,
		});
		setServerTokens(serverId, payload.tokens);
		// Auto-enable on first authorization so the user can immediately use the
		// server. If they were re-authorizing an already-enabled server, leave the
		// selection state alone — toggling would turn it off.
		if (!$selectedServerIds.has(serverId)) {
			toggleServer(serverId);
		}
		const server = $allMcpServers.find((s) => s.id === serverId);
		if (server) healthCheckServer({ ...server });
		pendingAuth = null;
		currentView = "list";
	}

	function handleAuthorizeCancel() {
		pendingAuth = null;
		currentView = "list";
	}

	function handleCancel() {
		currentView = "list";
	}

	function handleReauthorizeFromCard(detail: {
		serverId: string;
		serverUrl: string;
		oauth: MCPOAuthState;
	}) {
		const discovery: DiscoveryResponse = {
			requiresAuth: true,
			resource: detail.oauth.resource,
			resourceMetadataUrl: detail.oauth.resourceMetadataUrl,
			asMetadata: detail.oauth.asMetadata,
			clientInfo: detail.oauth.clientInfo,
			supportsDcr: !detail.oauth.clientWasManuallyEntered,
		};
		setServerOAuth(detail.serverId, detail.oauth);
		pendingAuth = {
			serverId: detail.serverId,
			serverUrl: detail.serverUrl,
			discovery,
		};
		currentView = "authorize";
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
				{:else if currentView === "authorize"}
					Authorize MCP server
				{:else}
					Add MCP server
				{/if}
			</h2>
			<p class="text-sm text-gray-600 dark:text-gray-400">
				{#if currentView === "list"}
					Manage MCP servers to extend {publicConfig.PUBLIC_APP_NAME} with external tools.
				{:else if currentView === "authorize"}
					Sign in to {pendingAuth?.serverUrl} so {publicConfig.PUBLIC_APP_NAME} can call its tools on
					your behalf.
				{:else}
					Add a custom MCP server to {publicConfig.PUBLIC_APP_NAME}.
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
							{$allMcpServers.length === 1 ? "server" : "servers"} configured
						</p>
						<p class="text-xs text-gray-600 dark:text-gray-400">
							{enabledCount} enabled
						</p>
					</div>
				</div>

				<div class="flex gap-2">
					<button
						onclick={handleRefresh}
						disabled={isRefreshing}
						class="btn gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
					>
						<IconRefresh class="size-4 {isRefreshing ? 'animate-spin' : ''}" />
						{isRefreshing ? "Refreshing…" : "Refresh"}
					</button>
					<button
						onclick={() => (currentView = "add")}
						class="btn flex items-center gap-0.5 rounded-lg bg-blue-600 py-1.5 pl-2 pr-3 text-sm font-medium text-white hover:bg-blue-600"
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
								onclick={() => (currentView = "add")}
								class="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
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
									onreauthorize={handleReauthorizeFromCard}
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
			<AddServerForm onsubmit={handleAddServer} oncancel={handleCancel} />
		{:else if currentView === "authorize" && pendingAuth}
			<AuthorizeStep
				discovery={pendingAuth.discovery}
				serverUrl={pendingAuth.serverUrl}
				serverId={pendingAuth.serverId}
				onauthorized={handleAuthorized}
				oncancel={handleAuthorizeCancel}
			/>
		{/if}
	</div>
</Modal>
