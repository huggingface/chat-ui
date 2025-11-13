<script lang="ts">
	import CarbonTrashCan from "~icons/carbon/trash-can";
	import CarbonArrowUpRight from "~icons/carbon/arrow-up-right";
	import CarbonLogoGithub from "~icons/carbon/logo-github";

	import { useSettingsStore } from "$lib/stores/settings";
	import Switch from "$lib/components/Switch.svelte";

	import { goto } from "$app/navigation";
	import { error } from "$lib/stores/errors";
	import { base } from "$app/paths";
	import { page } from "$app/state";
	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";
	import { useAPIClient, handleResponse } from "$lib/APIClient";
	import { onMount } from "svelte";
	import { browser } from "$app/environment";
	import { getThemePreference, setTheme, type ThemePreference } from "$lib/switchTheme";

	const publicConfig = usePublicConfig();
	let settings = useSettingsStore();

	const client = useAPIClient();

	let OPENAI_BASE_URL: string | null = $state(null);
	onMount(async () => {
		try {
			const cfg = await client.debug.config.get().then(handleResponse);
			OPENAI_BASE_URL = (cfg as { OPENAI_BASE_URL?: string }).OPENAI_BASE_URL || null;
		} catch (e) {
			// ignore if debug endpoint is unavailable
		}
	});

	let themePref: ThemePreference = $state(browser ? getThemePreference() : "system");

	// Admin: model refresh UI state
	let refreshing: boolean = $state(false);
	let refreshMessage: string | null = $state(null);

	// Auto-save security API settings when changed (debounced)
	let settingsTimeout: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		clearTimeout(settingsTimeout);
		settingsTimeout = setTimeout(() => {
			settings.set({
				securityApiEnabled: $settings.securityApiEnabled,
				securityApiUrl: $settings.securityApiUrl,
				securityApiKey: $settings.securityApiKey,
				llmApiUrl: $settings.llmApiUrl,
				llmApiKey: $settings.llmApiKey,
			});
		}, 300);
		return () => clearTimeout(settingsTimeout);
	});
</script>

<div class="flex w-full flex-col gap-4">
	<h2 class="text-center text-lg font-semibold text-gray-800 dark:text-gray-200 md:text-left">
		Application Settings
	</h2>

	{#if OPENAI_BASE_URL !== null}
		<div
			class="mt-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[12px] text-gray-700 dark:border-gray-700 dark:bg-gray-700/80 dark:text-gray-300"
		>
			<span class="font-medium">API Base URL:</span>
			<code class="ml-1 break-all font-mono text-[12px] text-gray-800 dark:text-gray-100"
				>{OPENAI_BASE_URL}</code
			>
		</div>
	{/if}
	{#if !!publicConfig.PUBLIC_COMMIT_SHA}
		<div
			class="flex flex-col items-start justify-between text-xl font-semibold text-gray-800 dark:text-gray-200"
		>
			<a
				href={`https://github.com/huggingface/chat-ui/commit/${publicConfig.PUBLIC_COMMIT_SHA}`}
				target="_blank"
				rel="noreferrer"
				class="text-sm font-light text-gray-500 dark:text-gray-400"
			>
				Latest deployment <span class="gap-2 font-mono"
					>{publicConfig.PUBLIC_COMMIT_SHA.slice(0, 7)}</span
				>
			</a>
		</div>
	{/if}
	{#if page.data.isAdmin}
		<div class="flex items-center gap-2">
			<p
				class="rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-700 dark:bg-red-500/10 dark:text-red-300"
			>
				Admin mode
			</p>
			<button
				class="btn rounded-md text-xs"
				class:underline={!refreshing}
				type="button"
				onclick={async () => {
					try {
						refreshing = true;
						refreshMessage = null;
						const res = await client.models.refresh.post().then(handleResponse);
						const delta = `+${res.added.length} −${res.removed.length} ~${res.changed.length}`;
						refreshMessage = `Refreshed in ${res.durationMs} ms • ${delta} • total ${res.total}`;
						await goto(page.url.pathname, { invalidateAll: true });
					} catch (e) {
						console.error(e);
						$error = "Model refresh failed";
					} finally {
						refreshing = false;
					}
				}}
				disabled={refreshing}
			>
				{refreshing ? "Refreshing…" : "Refresh models"}
			</button>
			{#if refreshMessage}
				<span class="text-xs text-gray-600 dark:text-gray-400">{refreshMessage}</span>
			{/if}
		</div>
	{/if}
	<div class="flex h-full flex-col gap-4 max-sm:pt-0">
		<div
			class="rounded-xl border border-gray-200 bg-white px-3 shadow-sm dark:border-gray-700 dark:bg-gray-800"
		>
			<div class="divide-y divide-gray-200 dark:divide-gray-700">
				{#if publicConfig.PUBLIC_APP_DATA_SHARING === "1"}
					<div class="flex items-start justify-between py-3">
						<div>
							<div class="text-[13px] font-medium text-gray-800 dark:text-gray-200">
								Share with model authors
							</div>
							<p class="text-[12px] text-gray-500 dark:text-gray-400">
								Sharing your data helps improve open models over time.
							</p>
						</div>
						<Switch
							name="shareConversationsWithModelAuthors"
							bind:checked={$settings.shareConversationsWithModelAuthors}
						/>
					</div>
				{/if}

				<div class="flex items-start justify-between py-3">
					<div>
						<div class="text-[13px] font-medium text-gray-800 dark:text-gray-200">
							Disable streaming tokens
						</div>
						<p class="text-[12px] text-gray-500 dark:text-gray-400">
							Show responses only when complete.
						</p>
					</div>
					<Switch name="disableStream" bind:checked={$settings.disableStream} />
				</div>

				<div class="flex items-start justify-between py-3">
					<div>
						<div class="text-[13px] font-medium text-gray-800 dark:text-gray-200">
							Paste text directly
						</div>
						<p class="text-[12px] text-gray-500 dark:text-gray-400">
							Paste long text directly into chat instead of a file.
						</p>
					</div>
					<Switch name="directPaste" bind:checked={$settings.directPaste} />
				</div>

				<!-- Theme selector -->
				<div class="flex items-start justify-between py-3">
					<div>
						<div class="text-[13px] font-medium text-gray-800 dark:text-gray-200">Theme</div>
						<p class="text-[12px] text-gray-500 dark:text-gray-400">
							Choose light, dark, or follow system.
						</p>
					</div>
					<div
						class="flex overflow-hidden rounded-md border text-center dark:divide-gray-600 dark:border-gray-600 max-sm:flex-col max-sm:divide-y sm:items-center sm:divide-x"
					>
						<button
							class={"inline-flex items-center justify-center px-2.5 py-1 text-center text-xs " +
								(themePref === "system"
									? "bg-black text-white dark:border-white/10 dark:bg-white/80 dark:text-gray-900"
									: "hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700/60")}
							onclick={() => {
								setTheme("system");
								themePref = "system";
							}}
						>
							system
						</button>
						<button
							class={"inline-flex items-center justify-center px-2.5 py-1 text-center text-xs " +
								(themePref === "light"
									? "bg-black text-white dark:border-white/10 dark:bg-white/80 dark:text-gray-900"
									: "hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700/60")}
							onclick={() => {
								setTheme("light");
								themePref = "light";
							}}
						>
							light
						</button>
						<button
							class={"inline-flex items-center justify-center px-2.5 py-1 text-center text-xs " +
								(themePref === "dark"
									? "bg-black text-white dark:border-white/10 dark:bg-white/80 dark:text-gray-900"
									: "hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700/60")}
							onclick={() => {
								setTheme("dark");
								themePref = "dark";
							}}
						>
							dark
						</button>
					</div>
				</div>
			</div>
		</div>

		<!-- Security API Settings -->
		<div
			class="rounded-xl border border-gray-200 bg-white px-3 shadow-sm dark:border-gray-700 dark:bg-gray-800"
		>
			<div class="divide-y divide-gray-200 dark:divide-gray-700">
				<div class="py-3">
					<div class="mb-3 text-[13px] font-semibold text-gray-800 dark:text-gray-200">
						Security API Settings
					</div>
					<div class="space-y-3">
						<div class="flex items-start justify-between">
							<div class="flex-1">
								<div class="text-[13px] font-medium text-gray-800 dark:text-gray-200">
									Enable Security API
								</div>
								<p class="text-[12px] text-gray-500 dark:text-gray-400">
									Route messages through security API before sending to LLM.
								</p>
							</div>
							<Switch
								name="securityApiEnabled"
								bind:checked={$settings.securityApiEnabled}
							/>
						</div>

						<div>
							<label class="block text-[12px] font-medium text-gray-700 dark:text-gray-300">
								Security API URL
							</label>
							<input
								type="text"
								bind:value={$settings.securityApiUrl}
								oninput={() => {
									settings.set({ securityApiUrl: $settings.securityApiUrl });
								}}
								placeholder="https://api.example.com/v1"
								class="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-[12px] dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
							/>
						</div>

						<div>
							<label class="block text-[12px] font-medium text-gray-700 dark:text-gray-300">
								Security API Key
							</label>
							<input
								type="password"
								bind:value={$settings.securityApiKey}
								oninput={() => {
									settings.set({ securityApiKey: $settings.securityApiKey });
								}}
								placeholder="sk-..."
								class="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-[12px] dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
							/>
						</div>
					</div>
				</div>
			</div>
		</div>

		<!-- LLM API Override Settings -->
		<div
			class="rounded-xl border border-gray-200 bg-white px-3 shadow-sm dark:border-gray-700 dark:bg-gray-800"
		>
			<div class="divide-y divide-gray-200 dark:divide-gray-700">
				<div class="py-3">
					<div class="mb-3 text-[13px] font-semibold text-gray-800 dark:text-gray-200">
						LLM API Override Settings (Optional)
					</div>
					<p class="mb-3 text-[12px] text-gray-500 dark:text-gray-400">
						Override default LLM API settings. Leave empty to use model defaults.
					</p>
					<div class="space-y-3">
						<div>
							<label class="block text-[12px] font-medium text-gray-700 dark:text-gray-300">
								LLM API URL
							</label>
							<input
								type="text"
								bind:value={$settings.llmApiUrl}
								oninput={() => {
									settings.set({ llmApiUrl: $settings.llmApiUrl });
								}}
								placeholder="https://api.openai.com/v1"
								class="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-[12px] dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
							/>
						</div>

						<div>
							<label class="block text-[12px] font-medium text-gray-700 dark:text-gray-300">
								LLM API Key
							</label>
							<input
								type="password"
								bind:value={$settings.llmApiKey}
								oninput={() => {
									settings.set({ llmApiKey: $settings.llmApiKey });
								}}
								placeholder="sk-..."
								class="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-[12px] dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
							/>
						</div>
					</div>
				</div>
			</div>
		</div>

		<div class="mt-6 flex flex-col gap-2 text-[13px]">
			{#if publicConfig.isHuggingChat}
				<a
					href="https://github.com/huggingface/chat-ui"
					target="_blank"
					class="flex items-center underline decoration-gray-300 underline-offset-2 hover:decoration-gray-700 dark:decoration-gray-700 dark:hover:decoration-gray-400"
					><CarbonLogoGithub class="mr-1.5 shrink-0 text-sm " /> Github repository</a
				>
				<a
					href="https://huggingface.co/settings/inference-providers/settings"
					target="_blank"
					class="flex items-center underline decoration-gray-300 underline-offset-2 hover:decoration-gray-700 dark:decoration-gray-700 dark:hover:decoration-gray-400"
					><CarbonArrowUpRight class="mr-1.5 shrink-0 text-sm " /> Providers settings</a
				>
				<a
					href="https://huggingface.co/spaces/huggingchat/chat-ui/discussions/764"
					target="_blank"
					rel="noreferrer"
					class="flex items-center underline decoration-gray-300 underline-offset-2 hover:decoration-gray-700 dark:decoration-gray-700 dark:hover:decoration-gray-400"
					><CarbonArrowUpRight class="mr-1.5 shrink-0 text-sm " /> Share your feedback on HuggingChat</a
				>
				<a
					href="{base}/privacy"
					class="flex items-center underline decoration-gray-300 underline-offset-2 hover:decoration-gray-700 dark:decoration-gray-700 dark:hover:decoration-gray-400"
					><CarbonArrowUpRight class="mr-1.5 shrink-0 text-sm " /> About & Privacy</a
				>
			{/if}
			<button
				onclick={async (e) => {
					e.preventDefault();

					confirm("Are you sure you want to delete all conversations?") &&
						client.conversations
							.delete()
							.then(async () => {
								await goto(`${base}/`, { invalidateAll: true });
							})
							.catch((err) => {
								console.error(err);
								$error = err.message;
							});
				}}
				type="submit"
				class="flex items-center underline decoration-red-200 underline-offset-2 hover:decoration-red-500 dark:decoration-red-900 dark:hover:decoration-red-700"
				><CarbonTrashCan class="mr-2 inline text-sm text-red-500" />Delete all conversations</button
			>
		</div>
	</div>
</div>
