<script lang="ts">
	import { untrack } from "svelte";
	import type { DiscoveryResponse } from "$lib/utils/mcpOAuth";
	import {
		openAuthPopup,
		runFullPageAuthFlow,
		startAuthFlow,
		type OAuthCallbackPayload,
	} from "$lib/utils/mcpOAuth";
	import type { MCPClientInformation } from "$lib/types/Tool";
	import IconWarning from "~icons/carbon/warning";
	import IconCheckmark from "~icons/carbon/checkmark-filled";
	import LucideShieldCheck from "~icons/lucide/shield-check";

	interface Props {
		discovery: DiscoveryResponse;
		serverUrl: string;
		serverId: string; // required so the redirect fallback can route back
		onauthorized: (payload: OAuthCallbackPayload, clientInfo: MCPClientInformation) => void;
		oncancel: () => void;
	}

	let { discovery, serverUrl, serverId, onauthorized, oncancel }: Props = $props();

	let phase = $state<"idle" | "starting" | "popup" | "manual" | "error" | "done">(
		untrack(() => (discovery.clientInfo ? "idle" : "manual"))
	);
	let errorMessage = $state<string | null>(null);
	let manualClientId = $state("");
	let manualClientSecret = $state("");
	let popupBlocked = $state(false);

	const issuerHost = $derived.by(() => {
		const issuer = discovery.asMetadata?.issuer;
		if (!issuer) return "";
		try {
			return new URL(issuer).host;
		} catch {
			return issuer;
		}
	});

	function buildClientInfo(): MCPClientInformation | null {
		if (discovery.clientInfo) return discovery.clientInfo;
		if (!manualClientId.trim()) {
			errorMessage = "Client ID is required";
			return null;
		}
		return {
			client_id: manualClientId.trim(),
			client_secret: manualClientSecret.trim() || undefined,
			redirect_uris: [], // server adds the canonical redirect_uri itself
		};
	}

	async function handleAuthorize() {
		errorMessage = null;
		const clientInfo = buildClientInfo();
		if (!clientInfo || !discovery.asMetadata || !discovery.resource) {
			phase = phase === "manual" ? "manual" : "error";
			return;
		}
		phase = "starting";
		try {
			const { authUrl, flowId } = await startAuthFlow({
				resource: discovery.resource,
				asMetadata: discovery.asMetadata,
				clientInfo,
				popupMode: true,
			});

			phase = "popup";
			try {
				const payload = await openAuthPopup(authUrl, flowId);
				if (!payload.ok) {
					phase = "error";
					errorMessage = payload.error || "Authorization failed";
					return;
				}
				phase = "done";
				onauthorized({ ...payload, resource: payload.resource ?? discovery.resource }, clientInfo);
			} catch (e) {
				const code = e instanceof Error ? e.message : String(e);
				if (code === "popup-blocked") {
					popupBlocked = true;
					// Fall back to a full-page redirect, preserving where the user is so
					// `consumeRedirectHandoff` can land them back here.
					const next =
						typeof window !== "undefined"
							? window.location.pathname + window.location.search
							: undefined;
					const restart = await startAuthFlow({
						resource: discovery.resource,
						asMetadata: discovery.asMetadata,
						clientInfo,
						popupMode: false,
						redirectNext: next,
					});
					runFullPageAuthFlow({
						authUrl: restart.authUrl,
						flowId: restart.flowId,
						serverId,
					});
					return;
				}
				if (code === "popup-closed") {
					phase = "idle";
					errorMessage = "Authorization window was closed before completing.";
					return;
				}
				phase = "error";
				errorMessage = code;
			}
		} catch (e) {
			phase = "error";
			errorMessage = e instanceof Error ? e.message : "Failed to start authorization";
		}
	}
</script>

<div class="space-y-4">
	<div
		class="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-blue-900 dark:border-blue-800/40 dark:bg-blue-900/20 dark:text-blue-100"
	>
		<LucideShieldCheck class="mt-0.5 size-5 flex-none text-blue-600 dark:text-blue-300" />
		<div class="text-sm leading-5">
			<p class="font-medium">This server requires authorization</p>
			<p class="mt-1 text-[13px] text-blue-800 dark:text-blue-100/90">
				It is hosted at <code class="rounded bg-white/60 px-1 dark:bg-black/30">{serverUrl}</code>
				and uses
				<strong>{issuerHost}</strong>
				to sign you in. You'll be redirected to grant access; tokens are stored in this browser only.
			</p>
		</div>
	</div>

	{#if phase === "manual"}
		<div class="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
			<p class="mb-2 text-sm text-gray-700 dark:text-gray-300">
				The authorization server doesn't support automatic client registration.
				<br />Paste a Client ID you have already registered with
				<strong>{issuerHost}</strong>.
			</p>
			<label class="mb-2 block text-sm">
				<span class="text-gray-700 dark:text-gray-300">Client ID</span>
				<input
					bind:value={manualClientId}
					class="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
					placeholder="Client ID from {issuerHost}"
				/>
			</label>
			<label class="block text-sm">
				<span class="text-gray-700 dark:text-gray-300">Client secret (optional)</span>
				<input
					type="password"
					bind:value={manualClientSecret}
					class="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
					placeholder="Leave blank for public clients"
				/>
			</label>
		</div>
	{/if}

	{#if phase === "popup"}
		<div class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
			<span class="size-3 animate-pulse rounded-full bg-blue-500"></span>
			Waiting for you to complete authorization in the popup window…
		</div>
	{/if}

	{#if phase === "done"}
		<div class="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
			<IconCheckmark class="size-4" />
			Authorized
		</div>
	{/if}

	{#if errorMessage}
		<div
			class="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800/40 dark:bg-red-900/20 dark:text-red-200"
		>
			<IconWarning class="mt-0.5 size-4 flex-none" />
			<div>{errorMessage}</div>
		</div>
	{/if}

	{#if popupBlocked}
		<div class="text-xs text-gray-500 dark:text-gray-400">
			Popup was blocked — falling back to full-page redirect…
		</div>
	{/if}

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
			onclick={handleAuthorize}
			disabled={phase === "starting" || phase === "popup" || phase === "done"}
			class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
		>
			{#if phase === "starting"}
				Starting…
			{:else if phase === "popup"}
				Authorizing…
			{:else if phase === "done"}
				Done
			{:else}
				Authorize with {issuerHost}
			{/if}
		</button>
	</div>
</div>
