<script lang="ts">
	import type { Message } from '$lib/types/Message';
	import { snapScrollToBottom } from '$lib/actions/snapScrollToBottom';
	import ScrollToBottomBtn from '$lib/components/ScrollToBottomBtn.svelte';
	import ChatIntroduction from './ChatIntroduction.svelte';
	import ChatMessage from './ChatMessage.svelte';

	export let messages: Message[];

	let chatContainer: HTMLElement;
</script>

<div class="overflow-y-auto h-full" use:snapScrollToBottom={messages} bind:this={chatContainer}>
	<div class="max-w-3xl xl:max-w-4xl mx-auto px-5 pt-6 flex flex-col gap-8 h-full">
		{#each messages as message}
			<ChatMessage {message} />
		{:else}
			<ChatIntroduction on:message />
		{/each}
		<div class="h-32 flex-none" />
	</div>
	<ScrollToBottomBtn class="bottom-10 right-12" scrollNode={chatContainer} />
</div>
