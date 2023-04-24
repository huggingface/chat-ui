<script lang="ts">
	import type { Message } from "$lib/types/Message";
	import { snapScrollToBottom } from "$lib/actions/snapScrollToBottom";
	import ScrollToBottomBtn from "$lib/components/ScrollToBottomBtn.svelte";
	import { tick } from "svelte";

	import ChatIntroduction from "./ChatIntroduction.svelte";
	import ChatMessage from "./ChatMessage.svelte";

	export let messages: Message[];
	export let loading: boolean;
	export let pending: boolean;

	let chatContainer: HTMLElement;

	async function scrollToBottom() {
		await tick();
		chatContainer.scrollTop = chatContainer.scrollHeight;
	}

	// If last message is from user, scroll to bottom
	$: if (messages.at(-1)?.from === "user") {
		scrollToBottom();
	}
</script>

<div class="overflow-y-auto h-full" use:snapScrollToBottom={messages} bind:this={chatContainer}>
	<div class="max-w-3xl xl:max-w-4xl mx-auto px-5 pt-6 flex flex-col gap-8 h-full">
		{#each messages as message, i}
			<ChatMessage loading={loading && i === messages.length - 1} {message} />
		{:else}
			<ChatIntroduction on:message />
		{/each}
		{#if pending}
			<ChatMessage message={{ from: "assistant", content: "" }} />
		{/if}
		<div class="h-32 flex-none" />
	</div>
	<ScrollToBottomBtn class="bottom-10 right-12" scrollNode={chatContainer} />
</div>
