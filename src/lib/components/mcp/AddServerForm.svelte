<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import type { KeyValuePair } from "$lib/types/Tool";
	import type { OAuthServerMetadata } from "$lib/types/McpOAuth";
	import {
		validateMcpServerUrl,
		validateHeader,
		isSensitiveHeader,
	} from "$lib/utils/mcpValidation";
	import { checkOAuthRequired, startOAuthFlow } from "$lib/services/mcpOAuthService";
	import { reloadFromStorage } from "$lib/stores/mcpOAuthTokens";
	import IconEye from "~icons/carbon/view";
	import IconEyeOff from "~icons/carbon/view-off";
	import IconTrash from "~icons/carbon/trash-can";
	import IconAdd from "~icons/carbon/add";
	import IconWarning from "~icons/carbon/warning";
	import IconLocked from "~icons/carbon/locked";
	import IconCheckmark from "~icons/carbon/checkmark-filled";
	import IconPending from "~icons/carbon/pending-filled";

	interface Props {
		onsubmit: (server: {
			id?: string;
			name: string;
			url: string;
			headers?: KeyValuePair[];
			oauthEnabled?: boolean;
		}) => void;
		oncancel: () => void;
		initialName?: string;
		initialUrl?: string;
		initialHeaders?: KeyValuePair[];
		submitLabel?: string;
	}

	let {
		onsubmit,
		oncancel,
		initialName = "",
		initialUrl = "",
		initialHeaders = [],
		submitLabel = "Add Server",
	}: Props = $props();

	let name = $state(initialName);
	let url = $state(initialUrl);
	let headers = $state<KeyValuePair[]>(initialHeaders.length > 0 ? [...initialHeaders] : []);
	let showHeaderValues = $state<Record<number, boolean>>({});
	let error = $state<string | null>(null);

	let isCheckingOAuth = $state(false);
	let oauthRequired = $state(false);
	let oauthMetadata = $state<OAuthServerMetadata | null>(null);
	let oauthCompleted = $state(false);
	let oauthError = $state<string | null>(null);
	let oauthCheckTimeout: ReturnType<typeof setTimeout> | undefined;
	let pendingServerId = $state<string | null>(null);
	let oauthPopup = $state<Window | null>(null);
	let popupPollTimer: ReturnType<typeof setInterval> | undefined;

	$effect(() => {
		if (url) {
			oauthRequired = false;
			oauthMetadata = null;
			oauthCompleted = false;
			oauthError = null;

			clearTimeout(oauthCheckTimeout);
			oauthCheckTimeout = setTimeout(() => {
				checkServerOAuth();
			}, 500);
		}
	});

	async function checkServerOAuth() {
		if (!url.trim()) return;

		const validUrl = validateMcpServerUrl(url);
		if (!validUrl) return;

		isCheckingOAuth = true;
		oauthError = null;

		try {
			const result = await checkOAuthRequired(validUrl);
			oauthRequired = result.required;
			oauthMetadata = result.metadata ?? null;

			if (result.error) {
				oauthError = result.error;
			}
		} catch (err) {
			console.error("OAuth check failed:", err);
			oauthError = err instanceof Error ? err.message : "Failed to check authentication";
		} finally {
			isCheckingOAuth = false;
		}
	}

	async function handleStartOAuth() {
		if (!oauthMetadata) return;

		pendingServerId = `pending-${crypto.randomUUID()}`;
		oauthError = null;

		if (popupPollTimer) {
			clearInterval(popupPollTimer);
			popupPollTimer = undefined;
		}

		try {
			oauthPopup = await startOAuthFlow(
				pendingServerId,
				url,
				name || "MCP Server",
				oauthMetadata,
				window.location.href
			);

			if (oauthPopup) {
				popupPollTimer = setInterval(() => {
					if (oauthPopup?.closed) {
						clearInterval(popupPollTimer);
						popupPollTimer = undefined;
						oauthPopup = null;

						if (!oauthCompleted) {
							oauthError = "Authentication window was closed";
						}
					}
				}, 500);
			}
		} catch (err) {
			oauthError = err instanceof Error ? err.message : "Failed to start authentication";
			pendingServerId = null;
			oauthPopup = null;
		}
	}

	function handleOAuthMessage(event: MessageEvent) {
		if (event.origin !== window.location.origin) return;

		if (event.data?.type === "mcp-oauth-complete") {
			if (event.data.serverId !== pendingServerId) return;

			if (popupPollTimer) {
				clearInterval(popupPollTimer);
				popupPollTimer = undefined;
			}
			oauthPopup = null;

			if (event.data.success) {
				oauthCompleted = true;
				oauthError = null;
				reloadFromStorage();
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
		clearTimeout(oauthCheckTimeout);
		if (popupPollTimer) {
			clearInterval(popupPollTimer);
		}
	});

	function addHeader() {
		headers = [...headers, { key: "", value: "" }];
	}

	function removeHeader(index: number) {
		headers = headers.filter((_, i) => i !== index);
		delete showHeaderValues[index];
	}

	function toggleHeaderVisibility(index: number) {
		showHeaderValues = {
			...showHeaderValues,
			[index]: !showHeaderValues[index],
		};
	}

	function validate(): boolean {
		if (!name.trim()) {
			error = "Server name is required";
			return false;
		}

		if (!url.trim()) {
			error = "Server URL is required";
			return false;
		}

		const urlValidation = validateMcpServerUrl(url);
		if (!urlValidation) {
			error = "Invalid URL.";
			return false;
		}

		if (oauthRequired && !oauthCompleted) {
			error = "Please complete OAuth authentication first";
			return false;
		}

		// Validate headers
		for (let i = 0; i < headers.length; i++) {
			const header = headers[i];
			if (header.key.trim() || header.value.trim()) {
				const headerError = validateHeader(header.key, header.value);
				if (headerError) {
					error = `Header ${i + 1}: ${headerError}`;
					return false;
				}
			}
		}

		error = null;
		return true;
	}

	function handleSubmit() {
		if (!validate()) return;

		// Filter out empty headers
		const filteredHeaders = headers.filter((h) => h.key.trim() && h.value.trim());

		onsubmit({
			id: pendingServerId ?? undefined,
			name: name.trim(),
			url: url.trim(),
			headers: filteredHeaders.length > 0 ? filteredHeaders : undefined,
			oauthEnabled: oauthRequired && oauthCompleted,
		});
	}
</script>

<div class="space-y-4">
	<!-- Server Name -->
	<div>
		<label
			for="server-name"
			class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
		>
			Server Name <span class="text-red-500">*</span>
		</label>
		<input
			id="server-name"
			type="text"
			bind:value={name}
			placeholder="My MCP Server"
			class="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
		/>
	</div>

	<!-- Server URL -->
	<div>
		<label for="server-url" class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
			Server URL <span class="text-red-500">*</span>
		</label>
		<input
			id="server-url"
			type="url"
			bind:value={url}
			placeholder="https://example.com/mcp"
			class="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
		/>
	</div>

	<!-- OAuth Status -->
	{#if isCheckingOAuth}
		<div class="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-800">
			<IconPending class="size-4 animate-spin text-gray-500 dark:text-gray-400" />
			<span class="text-sm text-gray-600 dark:text-gray-400">
				Checking authentication requirements...
			</span>
		</div>
	{:else if oauthRequired}
		<div
			class="rounded-lg border p-4 {oauthCompleted
				? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20'
				: 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20'}"
		>
			<div class="flex items-start gap-3">
				{#if oauthCompleted}
					<div
						class="flex size-8 items-center justify-center rounded-full bg-green-100 dark:bg-green-800/50"
					>
						<IconCheckmark class="size-5 text-green-600 dark:text-green-400" />
					</div>
					<div>
						<p class="font-medium text-green-800 dark:text-green-200">Authenticated</p>
						<p class="mt-0.5 text-sm text-green-700 dark:text-green-300">
							OAuth authentication completed successfully. You can now add this server.
						</p>
					</div>
				{:else}
					<div
						class="flex size-8 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-800/50"
					>
						<IconLocked class="size-5 text-blue-600 dark:text-blue-400" />
					</div>
					<div class="flex-1">
						<p class="font-medium text-blue-800 dark:text-blue-200">Authentication Required</p>
						<p class="mt-0.5 text-sm text-blue-700 dark:text-blue-300">
							This server requires OAuth authentication to access its tools.
						</p>
						{#if oauthError}
							<p class="mt-2 text-sm text-red-600 dark:text-red-400">
								{oauthError}
							</p>
						{/if}
						<button
							type="button"
							onclick={handleStartOAuth}
							class="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
						>
							Sign in with OAuth
						</button>
					</div>
				{/if}
			</div>
		</div>
	{/if}

	<!-- HTTP Headers -->
	<details class="rounded-lg border border-gray-200 dark:border-gray-700">
		<summary class="cursor-pointer px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300">
			HTTP Headers (Optional)
		</summary>
		<div class="space-y-2 border-t border-gray-200 p-4 dark:border-gray-700">
			{#if headers.length === 0}
				<p class="text-sm text-gray-500 dark:text-gray-400">No headers configured</p>
			{:else}
				{#each headers as header, i}
					<div class="flex gap-2">
						<input
							bind:value={header.key}
							placeholder="Header name (e.g., Authorization)"
							class="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
						/>
						<div class="relative flex-1">
							<input
								bind:value={header.value}
								type={showHeaderValues[i] ? "text" : "password"}
								placeholder="Value"
								class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 pr-10 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
							/>
							{#if isSensitiveHeader(header.key)}
								<button
									type="button"
									onclick={() => toggleHeaderVisibility(i)}
									class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
									title={showHeaderValues[i] ? "Hide value" : "Show value"}
								>
									{#if showHeaderValues[i]}
										<IconEyeOff class="size-4" />
									{:else}
										<IconEye class="size-4" />
									{/if}
								</button>
							{/if}
						</div>
						<button
							type="button"
							onclick={() => removeHeader(i)}
							class="rounded-lg bg-red-100 p-2 text-red-600 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50"
							title="Remove header"
						>
							<IconTrash class="size-4" />
						</button>
					</div>
				{/each}
			{/if}

			<button
				type="button"
				onclick={addHeader}
				class="flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
			>
				<IconAdd class="size-4" />
				Add Header
			</button>

			<p class="text-xs text-gray-500 dark:text-gray-400">
				Common examples:<br />
				• Bearer token:
				<code class="rounded bg-gray-100 px-1 dark:bg-gray-700"
					>Authorization: Bearer YOUR_TOKEN</code
				><br />
				• API key:
				<code class="rounded bg-gray-100 px-1 dark:bg-gray-700">X-API-Key: YOUR_KEY</code>
			</p>
		</div>
	</details>

	<!-- Security warning about custom MCP servers -->
	<div
		class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900 dark:border-yellow-900/40 dark:bg-yellow-900/20 dark:text-yellow-100"
	>
		<div class="flex items-start gap-3">
			<IconWarning class="mt-0.5 size-4 flex-none text-amber-600 dark:text-yellow-300" />
			<div class="text-sm leading-5">
				<p class="font-medium">Be careful with custom MCP servers.</p>
				<p class="mt-1 text-[13px] text-amber-800 dark:text-yellow-100/90">
					They receive your requests (including conversation context and any headers you add) and
					can run powerful tools on your behalf. Only add servers you trust and review their source.
					Never share confidental informations.
				</p>
			</div>
		</div>
	</div>

	<!-- Error message -->
	{#if error}
		<div
			class="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20"
		>
			<p class="text-sm text-red-800 dark:text-red-200">{error}</p>
		</div>
	{/if}

	<!-- Actions -->
	<div class="flex justify-end gap-2">
		<button
			type="button"
			onclick={oncancel}
			class="rounded-lg bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
		>
			Cancel
		</button>
		<button
			type="button"
			onclick={handleSubmit}
			class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
		>
			{submitLabel}
		</button>
	</div>
</div>
