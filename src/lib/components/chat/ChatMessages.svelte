<script lang="ts">
	import type { Message } from "$lib/types/Message";
	import { snapScrollToBottom } from "$lib/actions/snapScrollToBottom";
	import ScrollToBottomBtn from "$lib/components/ScrollToBottomBtn.svelte";
	import { tick } from "svelte";
	import { randomUUID } from "$lib/utils/randomUuid";
	import type { Model } from "$lib/types/Model";
	import ChatIntroduction from "./ChatIntroduction.svelte";
	import ChatMessage from "./ChatMessage.svelte";
	import type { WebSearchUpdate } from "$lib/types/MessageUpdate";
	import { browser } from "$app/environment";
	import SystemPromptModal from "../SystemPromptModal.svelte";
	import type { Assistant } from "$lib/types/Assistant";
	import AssistantIntroduction from "./AssistantIntroduction.svelte";
	import { page } from "$app/stores";
	import { base } from "$app/paths";

	export let messages: Message[];
	export let loading: boolean;
	export let pending: boolean;
	export let isAuthor: boolean;
	export let currentModel: Model;
	export let assistant: Assistant | undefined;
	export let models: Model[];
	export let preprompt: string | undefined;
	export let readOnly: boolean;

	let chatContainer: HTMLElement;

	export let webSearchMessages: WebSearchUpdate[] = [];

	async function scrollToBottom() {
		await tick();
		chatContainer.scrollTop = chatContainer.scrollHeight;
	}

	// If last message is from user, scroll to bottom
	$: if (browser && messages[messages.length - 1]?.from === "user") {
		scrollToBottom();
	}
</script>

<div
	class="scrollbar-custom mr-1 h-full overflow-y-auto"
	use:snapScrollToBottom={messages.length ? [...messages, ...webSearchMessages] : false}
	bind:this={chatContainer}
>
	<div class="mx-auto flex h-full max-w-3xl flex-col gap-6 px-5 pt-6 sm:gap-8 xl:max-w-4xl">
		{#each messages as message, i}
			{#if i === 0 && $page.data?.assistant}
				<a
					class="mx-auto flex items-center gap-1.5 rounded-full border border-gray-100 bg-gray-50 py-1 pl-1 pr-3 text-sm text-gray-800 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
					href="{base}/settings/assistants/{$page.data.assistant._id}"
				>
					{#if $page.data?.assistant.avatar}
						<img
							src="{base}/settings/assistants/{$page.data?.assistant._id.toString()}/avatar?hash=${$page
								.data?.assistant.avatar}"
							alt="Avatar"
							class="size-5 rounded-full object-cover"
						/>
					{:else}
						<div
							class="flex size-6 items-center justify-center rounded-full bg-gray-300 font-bold uppercase text-gray-500"
						>
							{$page.data?.assistant.name[0]}
						</div>
					{/if}

					{$page.data.assistant.name}
				</a>
			{:else if i === 0 && preprompt && preprompt != currentModel.preprompt}
				<SystemPromptModal preprompt={preprompt ?? ""} />
			{/if}
			<ChatMessage
				loading={loading && i === messages.length - 1}
				{message}
				{isAuthor}
				{readOnly}
				model={currentModel}
				webSearchMessages={i === messages.length - 1 ? webSearchMessages : []}
				on:retry
				on:vote
				on:continue
			/>
		{:else}
			{#if !assistant}
				<ChatIntroduction {models} {currentModel} on:message />
			{:else}
				<AssistantIntroduction {assistant} on:message />
			{/if}
		{/each}
		{#if pending && messages[messages.length - 1]?.from === "user"}
			<ChatMessage
				message={{ from: "assistant", content: "", id: randomUUID() }}
				model={currentModel}
				{webSearchMessages}
			/>
		{/if}
		<div class="h-44 flex-none" />
	</div>
	<ScrollToBottomBtn
		class="bottom-36 right-4 max-md:hidden lg:right-10"
		scrollNode={chatContainer}
	/>
</div>
