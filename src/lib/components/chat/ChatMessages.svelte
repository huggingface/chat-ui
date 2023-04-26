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

<div
	class="overflow-y-auto h-full scrollbar-custom mr-1"
	use:snapScrollToBottom={messages.length ? messages : false}
	bind:this={chatContainer}
>
	<div class="max-w-3xl xl:max-w-4xl mx-auto px-5 pt-6 flex flex-col gap-5 sm:gap-8 h-full">
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
	<ScrollToBottomBtn
		class="max-md:hidden bottom-36 right-4 lg:right-10"
		scrollNode={chatContainer}
	/>
</div>
