<script lang="ts">
	import { useSettingsStore } from "$lib/stores/settings";
	import CarbonClose from "~icons/carbon/close";
	import CarbonSettings from "~icons/carbon/settings";
	import { fly } from "svelte/transition";
	import { cubicInOut } from "svelte/easing";
	import Switch from "$lib/components/Switch.svelte";
	import type { Conversation } from "$lib/types/Conversation";

	/* eslint-disable prefer-const */
	let {
		open = $bindable(false),
		onclose,
		conversation = null,
		onConversationUpdate,
	} = $props<{
		open?: boolean;
		onclose?: () => void;
		conversation?: Conversation | null;
		onConversationUpdate?: (updates: Partial<Conversation>) => void;
	}>();
	/* eslint-enable prefer-const */

	const settings = useSettingsStore();

	// Initialize conversation-specific settings from conversation meta or fallback to global settings
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

	// Update local state when conversation or its meta changes
	$effect(() => {
		// Track conversation and its meta to detect changes
		void conversation?.id;
		void conversation?.meta?.securityApiEnabled;
		void conversation?.meta?.securityApiUrl;
		void conversation?.meta?.securityApiKey;
		void conversation?.meta?.llmApiUrl;
		void conversation?.meta?.llmApiKey;

		if (conversation) {
			conversationSecurityApiEnabled =
				conversation.meta?.securityApiEnabled ?? $settings.securityApiEnabled ?? false;
			conversationSecurityApiUrl =
				conversation.meta?.securityApiUrl ?? $settings.securityApiUrl ?? "";
			conversationSecurityApiKey =
				conversation.meta?.securityApiKey ?? $settings.securityApiKey ?? "";
			conversationLlmApiUrl = conversation.meta?.llmApiUrl ?? $settings.llmApiUrl ?? "";
			conversationLlmApiKey = conversation.meta?.llmApiKey ?? $settings.llmApiKey ?? "";
		} else {
			// Reset to global settings when conversation is null
			conversationSecurityApiEnabled = $settings.securityApiEnabled ?? false;
			conversationSecurityApiUrl = $settings.securityApiUrl ?? "";
			conversationSecurityApiKey = $settings.securityApiKey ?? "";
			conversationLlmApiUrl = $settings.llmApiUrl ?? "";
			conversationLlmApiKey = $settings.llmApiKey ?? "";
		}
	});

	function updateConversationMeta() {
		if (!onConversationUpdate || !conversation) {
			return;
		}

		// Always save conversation-specific settings when conversation exists
		onConversationUpdate({
			meta: {
				...conversation.meta,
				securityApiEnabled: conversationSecurityApiEnabled,
				securityApiUrl: conversationSecurityApiUrl || undefined,
				securityApiKey: conversationSecurityApiKey || undefined,
				llmApiUrl: conversationLlmApiUrl || undefined,
				llmApiKey: conversationLlmApiKey || undefined,
			},
		});
	}

	// Debounce conversation meta updates
	let metaUpdateTimeout: ReturnType<typeof setTimeout> | undefined;
	function scheduleMetaUpdate() {
		if (!conversation) {
			return;
		}
		clearTimeout(metaUpdateTimeout);
		metaUpdateTimeout = setTimeout(() => {
			updateConversationMeta();
		}, 300);
	}

	// Auto-save when conversation-specific settings change
	$effect(() => {
		// Track all conversation-specific settings
		void conversationSecurityApiEnabled;
		void conversationSecurityApiUrl;
		void conversationSecurityApiKey;
		void conversationLlmApiUrl;
		void conversationLlmApiKey;

		scheduleMetaUpdate();
		return () => clearTimeout(metaUpdateTimeout);
	});
</script>

{#if open}
	<!-- Backdrop -->
	<div
		class="fixed inset-0 z-40 bg-black/20 dark:bg-black/40"
		role="button"
		tabindex="-1"
		onclick={() => {
			open = false;
			onclose?.();
		}}
		onkeydown={(e) => {
			if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
				open = false;
				onclose?.();
			}
		}}
		transition:fly={{ opacity: 0, duration: 200 }}
	></div>

	<div
		class="fixed inset-y-0 right-0 z-50 w-80 bg-white shadow-xl dark:bg-gray-900 md:w-96"
		role="dialog"
		aria-modal="true"
		aria-labelledby="chat-settings-title"
		tabindex="-1"
		transition:fly={{ x: 400, duration: 300, easing: cubicInOut }}
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => {
			// Prevent keyboard events from propagating, but don't handle them here
			e.stopPropagation();
		}}
	>
		<div class="flex h-full flex-col">
			<!-- Header -->
			<div
				class="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700"
			>
				<div class="flex items-center gap-2">
					<CarbonSettings class="h-5 w-5 text-gray-600 dark:text-gray-400" />
					<div>
						<h2
							id="chat-settings-title"
							class="text-lg font-semibold text-gray-900 dark:text-gray-100"
						>
							Chat Settings
						</h2>
						<p class="text-xs text-gray-500 dark:text-gray-400">
							Settings apply to this conversation only
						</p>
					</div>
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
					<!-- Generation Settings -->
					<div>
						<h3 class="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
							Generation Settings
						</h3>
						<div class="space-y-3">
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
										></textarea>
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

					<!-- Conversation-Specific Settings -->
					<div>
						<div class="mb-2">
							<h3 class="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
								API Settings
							</h3>
							<p class="text-xs text-gray-500 dark:text-gray-400">
								These settings override global settings from Application Settings for this
								conversation only.
								{#if !conversation}
									<span class="mt-1 block text-orange-600 dark:text-orange-400">
										Start a conversation to save these settings.
									</span>
								{/if}
							</p>
						</div>
						<div
							class="space-y-3 rounded border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50"
						>
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
								<label
									for="security-api-url"
									class="block text-xs font-medium text-gray-700 dark:text-gray-300"
								>
									Security API URL
								</label>
								<input
									id="security-api-url"
									type="text"
									bind:value={conversationSecurityApiUrl}
									placeholder="https://api.example.com/v1"
									class="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
								/>
							</div>
							<div>
								<label
									for="security-api-key"
									class="block text-xs font-medium text-gray-700 dark:text-gray-300"
								>
									Security API Key
								</label>
								<input
									id="security-api-key"
									type="password"
									bind:value={conversationSecurityApiKey}
									placeholder="sk-..."
									class="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
								/>
							</div>
							<div>
								<label
									for="llm-api-url"
									class="block text-xs font-medium text-gray-700 dark:text-gray-300"
								>
									LLM API URL (Optional)
								</label>
								<input
									id="llm-api-url"
									type="text"
									bind:value={conversationLlmApiUrl}
									placeholder="https://api.openai.com/v1"
									class="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
								/>
							</div>
							<div>
								<label
									for="llm-api-key"
									class="block text-xs font-medium text-gray-700 dark:text-gray-300"
								>
									LLM API Key (Optional)
								</label>
								<input
									id="llm-api-key"
									type="password"
									bind:value={conversationLlmApiKey}
									placeholder="sk-..."
									class="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
								/>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
{/if}
