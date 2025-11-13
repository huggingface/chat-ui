<script lang="ts">
	import { useSettingsStore } from "$lib/stores/settings";
	import CarbonClose from "~icons/carbon/close";
	import CarbonSettings from "~icons/carbon/settings";
	import { fly } from "svelte/transition";
	import { cubicInOut } from "svelte/easing";
	import Switch from "$lib/components/Switch.svelte";
	import type { Conversation } from "$lib/types/Conversation";

	interface Props {
		open?: boolean;
		onclose?: () => void;
		conversation?: Conversation | null;
		onConversationUpdate?: (updates: Partial<Conversation>) => void;
	}

	let { open = $bindable(false), onclose, conversation = null, onConversationUpdate } = $props();

	const settings = useSettingsStore();

	let useConversationSettings = $state(
		conversation?.meta?.securityApiEnabled !== undefined ||
			conversation?.meta?.securityApiUrl !== undefined ||
			conversation?.meta?.securityApiKey !== undefined ||
			conversation?.meta?.llmApiUrl !== undefined ||
			conversation?.meta?.llmApiKey !== undefined
	);

	let conversationSecurityApiEnabled = $state(
		conversation?.meta?.securityApiEnabled ?? $settings.securityApiEnabled ?? false
	);
	let conversationSecurityApiUrl = $state(
		conversation?.meta?.securityApiUrl ?? $settings.securityApiUrl ?? ""
	);
	let conversationSecurityApiKey = $state(
		conversation?.meta?.securityApiKey ?? $settings.securityApiKey ?? ""
	);
	let conversationLlmApiUrl = $state(conversation?.meta?.llmApiUrl ?? $settings.llmApiUrl ?? "");
	let conversationLlmApiKey = $state(conversation?.meta?.llmApiKey ?? $settings.llmApiKey ?? "");

	function updateConversationMeta() {
		if (!onConversationUpdate || !useConversationSettings) return;

		onConversationUpdate({
			meta: {
				...conversation?.meta,
				securityApiEnabled: conversationSecurityApiEnabled,
				securityApiUrl: conversationSecurityApiUrl || undefined,
				securityApiKey: conversationSecurityApiKey || undefined,
				llmApiUrl: conversationLlmApiUrl || undefined,
				llmApiKey: conversationLlmApiKey || undefined,
			},
		});
	}

	function clearConversationMeta() {
		if (!onConversationUpdate) return;

		const newMeta = { ...conversation?.meta };
		delete newMeta.securityApiEnabled;
		delete newMeta.securityApiUrl;
		delete newMeta.securityApiKey;
		delete newMeta.llmApiUrl;
		delete newMeta.llmApiKey;
		onConversationUpdate({ meta: Object.keys(newMeta).length > 0 ? newMeta : undefined });
	}

	// Debounce conversation meta updates
	let metaUpdateTimeout: ReturnType<typeof setTimeout> | undefined;
	function scheduleMetaUpdate() {
		clearTimeout(metaUpdateTimeout);
		metaUpdateTimeout = setTimeout(() => {
			if (useConversationSettings) {
				updateConversationMeta();
			} else {
				clearConversationMeta();
			}
		}, 300);
	}

	$effect(() => {
		scheduleMetaUpdate();
		return () => clearTimeout(metaUpdateTimeout);
	});
</script>

{#if open}
	<!-- Backdrop -->
	<div
		class="fixed inset-0 z-40 bg-black/20 dark:bg-black/40"
		onclick={() => {
			open = false;
			onclose?.();
		}}
		transition:fly={{ opacity: 0, duration: 200 }}
	></div>

	<div
		class="fixed inset-y-0 right-0 z-50 w-80 bg-white shadow-xl dark:bg-gray-900 md:w-96"
		transition:fly={{ x: 400, duration: 300, easing: cubicInOut }}
		onclick={(e) => e.stopPropagation()}
	>
		<div class="flex h-full flex-col">
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
				<div class="flex items-center gap-2">
					<CarbonSettings class="h-5 w-5 text-gray-600 dark:text-gray-400" />
					<h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">Chat Settings</h2>
				</div>
				<button
					onclick={() => {
						open = false;
						onclose?.();
					}}
					class="rounded-lg p-1 hover:bg-gray-100 dark:hover:bg-gray-800"
					aria-label="Close settings"
				>
					<CarbonClose class="h-5 w-5 text-gray-600 dark:text-gray-400" />
				</button>
			</div>

			<!-- Content -->
			<div class="flex-1 overflow-y-auto p-4">
				<div class="space-y-6">
					<!-- Security Settings -->
					<div>
						<h3 class="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
							Security Settings
						</h3>
						<div class="space-y-3">
							<label class="flex items-center gap-2">
								<input
									type="checkbox"
									bind:checked={$settings.shareConversationsWithModelAuthors}
									onchange={() => {
										settings.set({
											shareConversationsWithModelAuthors: $settings.shareConversationsWithModelAuthors,
										});
									}}
									class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
								/>
								<span class="text-sm text-gray-700 dark:text-gray-300">
									Share conversations with model authors
								</span>
							</label>
						</div>
					</div>

					<!-- Generation Settings -->
					<div>
						<h3 class="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
							Generation Settings
						</h3>
						<div class="space-y-3">
							<label class="flex items-center gap-2">
								<input
									type="checkbox"
									bind:checked={$settings.disableStream}
									onchange={() => {
										settings.set({ disableStream: $settings.disableStream });
									}}
									class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
								/>
								<span class="text-sm text-gray-700 dark:text-gray-300">Disable streaming</span>
							</label>
							<label class="flex items-center gap-2">
								<input
									type="checkbox"
									bind:checked={$settings.directPaste}
									onchange={() => {
										settings.set({ directPaste: $settings.directPaste });
									}}
									class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
								/>
								<span class="text-sm text-gray-700 dark:text-gray-300">Direct paste</span>
							</label>
						</div>
					</div>

					<!-- Custom Prompts -->
					<div>
						<h3 class="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
							Custom Prompts
						</h3>
						<p class="mb-2 text-xs text-gray-500 dark:text-gray-400">
							Set custom system prompts for specific models
						</p>
						<div class="space-y-2">
							{#each Object.entries($settings.customPrompts || {}) as [modelId, prompt]}
								<div class="flex items-start gap-2">
									<div class="flex-1">
										<input
											type="text"
											value={modelId}
											readonly
											class="mb-1 w-full rounded border border-gray-300 bg-gray-50 px-2 py-1 text-xs text-gray-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400"
										/>
										<textarea
											value={prompt}
											oninput={(e) => {
												const newPrompts = { ...($settings.customPrompts || {}) };
												newPrompts[modelId] = e.currentTarget.value;
												settings.set({ customPrompts: newPrompts });
											}}
											class="w-full rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800"
											rows="2"
										/>
									</div>
									<button
										onclick={() => {
											const newPrompts = { ...($settings.customPrompts || {}) };
											delete newPrompts[modelId];
											settings.set({ customPrompts: newPrompts });
										}}
										class="rounded p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
										aria-label="Remove prompt"
									>
										<CarbonClose class="h-4 w-4" />
									</button>
								</div>
							{/each}
						</div>
					</div>

					<!-- Security API Settings (Global) -->
					<div>
						<h3 class="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
							Security API Settings (Global)
						</h3>
						<div class="space-y-3">
							<div class="flex items-start justify-between">
								<div class="flex-1">
									<div class="text-xs font-medium text-gray-700 dark:text-gray-300">
										Enable Security API
									</div>
									<p class="text-xs text-gray-500 dark:text-gray-400">
										Route messages through security API
									</p>
								</div>
								<Switch
									name="securityApiEnabled"
									bind:checked={$settings.securityApiEnabled}
								/>
							</div>
							<div>
								<label class="block text-xs font-medium text-gray-700 dark:text-gray-300">
									Security API URL
								</label>
								<input
									type="text"
									bind:value={$settings.securityApiUrl}
									oninput={() => {
										settings.set({ securityApiUrl: $settings.securityApiUrl });
									}}
									placeholder="https://api.example.com/v1"
									class="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
								/>
							</div>
							<div>
								<label class="block text-xs font-medium text-gray-700 dark:text-gray-300">
									Security API Key
								</label>
								<input
									type="password"
									bind:value={$settings.securityApiKey}
									oninput={() => {
										settings.set({ securityApiKey: $settings.securityApiKey });
									}}
									placeholder="sk-..."
									class="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
								/>
							</div>
						</div>
					</div>

					<!-- Conversation-Specific Settings Override -->
					{#if conversation}
						<div>
							<h3 class="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
								Conversation-Specific Settings
							</h3>
							<div class="space-y-3">
								<div class="flex items-start justify-between">
									<div class="flex-1">
										<div class="text-xs font-medium text-gray-700 dark:text-gray-300">
											Use conversation-specific settings
										</div>
										<p class="text-xs text-gray-500 dark:text-gray-400">
											Override global settings for this conversation
										</p>
									</div>
									<Switch name="useConversationSettings" bind:checked={useConversationSettings} />
								</div>

								{#if useConversationSettings}
									<div class="space-y-3 rounded border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
										<div class="flex items-start justify-between">
											<div class="flex-1">
												<div class="text-xs font-medium text-gray-700 dark:text-gray-300">
													Enable Security API
												</div>
											</div>
											<Switch
												name="conversationSecurityApiEnabled"
												bind:checked={conversationSecurityApiEnabled}
											/>
										</div>
										<div>
											<label class="block text-xs font-medium text-gray-700 dark:text-gray-300">
												Security API URL
											</label>
											<input
												type="text"
												bind:value={conversationSecurityApiUrl}
												placeholder="https://api.example.com/v1"
												class="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
											/>
										</div>
										<div>
											<label class="block text-xs font-medium text-gray-700 dark:text-gray-300">
												Security API Key
											</label>
											<input
												type="password"
												bind:value={conversationSecurityApiKey}
												placeholder="sk-..."
												class="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
											/>
										</div>
										<div>
											<label class="block text-xs font-medium text-gray-700 dark:text-gray-300">
												LLM API URL (Optional)
											</label>
											<input
												type="text"
												bind:value={conversationLlmApiUrl}
												placeholder="https://api.openai.com/v1"
												class="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
											/>
										</div>
										<div>
											<label class="block text-xs font-medium text-gray-700 dark:text-gray-300">
												LLM API Key (Optional)
											</label>
											<input
												type="password"
												bind:value={conversationLlmApiKey}
												placeholder="sk-..."
												class="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
											/>
										</div>
									</div>
								{/if}
							</div>
						</div>
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}

