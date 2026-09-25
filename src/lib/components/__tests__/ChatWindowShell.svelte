<script lang="ts">
	// The real ChatWindow in a copy of the root layout's shell — fixed, h-dvh, the mobile nav's
	// row above it — so layout tests measure the heights a phone would get.
	import { untrack } from "svelte";
	import ChatWindow from "$lib/components/chat/ChatWindow.svelte";
	import { createSettingsStore } from "$lib/stores/settings";
	import { createConversationsStore } from "$lib/stores/conversations.svelte";
	import type { Message } from "$lib/types/Message";
	import type { Model } from "$lib/types/Model";

	let {
		messages,
		currentModel,
		models,
	}: { messages: Message[]; currentModel: Model; models: Model[] } = $props();

	createSettingsStore({
		shareConversationsWithModelAuthors: true,
		welcomeModalSeen: true,
		welcomeModalSeenAt: null,
		mlInternOnboardingSeen: true,
		activeModel: untrack(() => currentModel.id),
		customPrompts: {},
		customPromptsEnabled: {},
		multimodalOverrides: {},
		toolsOverrides: {},
		artifactsOverrides: {},
		hidePromptExamples: {},
		providerOverrides: {},
		reasoningEffortOverrides: {},
		reasoningOverrides: {},
		streamingMode: "raw",
		directPaste: false,
		hapticsEnabled: false,
	});
	createConversationsStore();
</script>

<div class="fixed grid h-dvh w-screen grid-cols-1 grid-rows-[auto_1fr] overflow-hidden text-smd">
	<div class="mx-4 mt-4 h-12" data-testid="mobile-nav"></div>
	<ChatWindow {messages} {currentModel} {models} />
</div>
