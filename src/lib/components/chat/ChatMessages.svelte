<script lang="ts">
	import type { Message } from "$lib/types/Message";
	import { snapScrollToBottom } from "$lib/actions/snapScrollToBottom";
	import ScrollToBottomBtn from "$lib/components/ScrollToBottomBtn.svelte";
	import { createEventDispatcher, tick } from "svelte";

	import ChatIntroduction from "./ChatIntroduction.svelte";
	import ChatMessage from "./ChatMessage.svelte";
	import { randomUUID } from "$lib/utils/randomUuid";

	const dispatch = createEventDispatcher<{ retry: { id: Message["id"]; content: string } }>();

	export let messages: Message[];
	export let loading: boolean;
	export let pending: boolean;
	export let currentModel: { name: string; displayName: string };

	let chatContainer: HTMLElement;

	async function scrollToBottom() {
		await tick();
		chatContainer.scrollTop = chatContainer.scrollHeight;
	}

	// If last message is from user, scroll to bottom
	$: if (messages[messages.length - 1]?.from === "user") {
		scrollToBottom();
	}
</script>

<div
	class="scrollbar-custom mr-1 h-full overflow-y-auto"
	use:snapScrollToBottom={messages.length ? messages : false}
	bind:this={chatContainer}
>
	<div class="mx-auto flex h-full max-w-3xl flex-col gap-5 px-5 pt-6 sm:gap-8 xl:max-w-4xl">
		{#each messages as message, i}
			<ChatMessage
				loading={loading && i === messages.length - 1}
				{message}
				on:retry={() => dispatch("retry", { id: message.id, content: message.content })}
			/>
		{:else}
			<ChatIntroduction on:message {currentModel} />
		{/each}
		{#if pending}
			<ChatMessage message={{ from: "assistant", content: "", id: randomUUID() }} />
		{/if}
		<div class="h-32 flex-none" />
	</div>
	<ScrollToBottomBtn
		class="bottom-36 right-4 max-md:hidden lg:right-10"
		scrollNode={chatContainer}
	/>
</div>
