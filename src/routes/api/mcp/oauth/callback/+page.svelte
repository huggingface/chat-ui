<script lang="ts">
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import { base } from "$app/paths";
	import { loadFlowState, clearFlowState } from "$lib/stores/mcpOAuthTokens";
	import { exchangeCodeForTokens, validateFlowState } from "$lib/services/mcpOAuthService";
	import IconCheckmark from "~icons/carbon/checkmark-filled";
	import IconWarning from "~icons/carbon/warning-filled";
	import IconPending from "~icons/carbon/pending-filled";

	type Status = "processing" | "success" | "error";

	let status = $state<Status>("processing");
	let errorMessage = $state<string>("");
	let serverName = $state<string>("");
	let returnTo = $state<string | undefined>(undefined);

	// Helper to notify parent window (for popup mode)
	function notifyParent(serverId: string | undefined, success: boolean, error?: string) {
		if (window.opener) {
			window.opener.postMessage(
				{
					type: "mcp-oauth-complete",
					serverId,
					success,
					error,
				},
				window.location.origin
			);
		}
	}

	// Check if we're in popup mode
	const isPopup = typeof window !== "undefined" && window.opener !== null;

	onMount(async () => {
		const url = new URL(window.location.href);
		const code = url.searchParams.get("code");
		const state = url.searchParams.get("state");
		const error = url.searchParams.get("error");
		const errorDesc = url.searchParams.get("error_description");

		// Load stored flow state early to get serverId for error notifications
		const flowState = loadFlowState();

		// Handle OAuth error response from authorization server
		if (error) {
			status = "error";
			errorMessage = errorDesc || error;
			clearFlowState();

			// Notify parent in popup mode
			if (isPopup) {
				notifyParent(flowState?.serverId, false, errorMessage);
			}
			return;
		}

		// Validate required parameters
		if (!code || !state) {
			status = "error";
			errorMessage = "Missing authorization code or state parameter";
			clearFlowState();

			if (isPopup) {
				notifyParent(flowState?.serverId, false, errorMessage);
			}
			return;
		}

		const validation = validateFlowState(flowState, state);
		if (!validation.valid || !flowState) {
			status = "error";
			errorMessage = validation.error || "Invalid flow state";
			clearFlowState();

			if (isPopup) {
				notifyParent(flowState?.serverId, false, errorMessage);
			}
			return;
		}

		serverName = flowState.serverName || flowState.serverUrl;
		returnTo = flowState.returnTo;

		try {
			await exchangeCodeForTokens(code, flowState);
			status = "success";

			if (isPopup) {
				notifyParent(flowState.serverId, true);
				setTimeout(() => window.close(), 500);
			} else {
				setTimeout(() => {
					goto(returnTo || `${base}/`);
				}, 1500);
			}
		} catch (err) {
			status = "error";
			errorMessage = err instanceof Error ? err.message : "Token exchange failed";
			clearFlowState();

			if (isPopup) {
				notifyParent(flowState.serverId, false, errorMessage);
			}
		}
	});

	function handleReturn() {
		goto(returnTo || `${base}/`);
	}
</script>

<div class="flex min-h-screen items-center justify-center bg-gray-100 dark:bg-gray-900">
	<div class="w-full max-w-md rounded-xl bg-white p-8 shadow-lg dark:bg-gray-800">
		<div class="text-center">
			{#if status === "processing"}
				<div
					class="mx-auto flex size-16 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30"
				>
					<IconPending class="size-8 animate-spin text-blue-600 dark:text-blue-400" />
				</div>
				<h1 class="mt-4 text-xl font-semibold text-gray-900 dark:text-white">
					Completing Authentication...
				</h1>
				<p class="mt-2 text-gray-600 dark:text-gray-400">
					Please wait while we complete the OAuth flow.
				</p>
			{:else if status === "success"}
				<div
					class="mx-auto flex size-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30"
				>
					<IconCheckmark class="size-8 text-green-600 dark:text-green-400" />
				</div>
				<h1 class="mt-4 text-xl font-semibold text-gray-900 dark:text-white">
					Authentication Successful!
				</h1>
				<p class="mt-2 text-gray-600 dark:text-gray-400">
					You can now use <span class="font-medium">{serverName}</span>
				</p>
				<p class="mt-4 text-sm text-gray-500 dark:text-gray-500">Redirecting...</p>
			{:else}
				<div
					class="mx-auto flex size-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30"
				>
					<IconWarning class="size-8 text-red-600 dark:text-red-400" />
				</div>
				<h1 class="mt-4 text-xl font-semibold text-gray-900 dark:text-white">
					Authentication Failed
				</h1>
				<p class="mt-2 text-sm text-red-600 dark:text-red-400">
					{errorMessage}
				</p>
				<button
					onclick={handleReturn}
					class="mt-6 rounded-lg bg-gray-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
				>
					Return to Chat
				</button>
			{/if}
		</div>
	</div>
</div>
