<script lang="ts">
	import type { Message } from '$lib/types/Message';
	import { createEventDispatcher } from 'svelte';
	import ChatMessages from './ChatMessages.svelte';
	import ChatInput from './ChatInput.svelte';

	export let messages: Message[] = [];
	export let disabled: boolean;

	let message: string;

	const dispatch = createEventDispatcher<{ message: string }>();
</script>

<div class="relative h-screen">
	<nav class="sm:hidden flex items-center h-12 border-b px-4 justify-between dark:border-gray-800">
		<button>[ ]</button>
		<button>New Chat</button>
		<button>+</button>
	</nav>
	<ChatMessages {messages} />
	<div
		class="flex max-md:border-t dark:border-gray-800 items-center max-md:dark:bg-gray-900 max-md:bg-white bg-gradient-to-t from-white dark:from-gray-900 to-transparent justify-center absolute inset-x-0 max-w-3xl xl:max-w-4xl mx-auto px-5 bottom-0 py-4 md:py-8 w-full"
	>
		<form
			on:submit|preventDefault={() => {
				dispatch('message', message);
				message = '';
			}}
			class="w-full relative flex items-center rounded-xl flex-1 max-w-4xl border bg-gray-100 focus-within:border-gray-300 dark:bg-gray-700 dark:border-gray-600 dark:focus-within:border-gray-500 transition-all"
		>
			<div class="w-full flex flex-1 border-none bg-transparent">
				<ChatInput
					placeholder="Ask anything"
					bind:value={message}
					{disabled}
					autofocus
					maxRows={10}
				/>
				<button
					class="p-1 px-[0.7rem] self-end my-1 h-[2.4rem] rounded-lg hover:bg-gray-100 enabled:dark:hover:text-gray-400 dark:hover:bg-gray-900 disabled:hover:bg-transparent dark:disabled:hover:bg-transparent disabled:opacity-60 dark:disabled:opacity-40 flex-shrink-0 transition-all mx-1"
					disabled={!message || disabled}
					type="submit"
				>
					<svg
						class="text-gray-500 dark:text-gray-300 pointer-events-none"
						xmlns="http://www.w3.org/2000/svg"
						xmlns:xlink="http://www.w3.org/1999/xlink"
						aria-hidden="true"
						focusable="false"
						role="img"
						width="1em"
						height="1em"
						preserveAspectRatio="xMidYMid meet"
						viewBox="0 0 32 32"
						><path
							d="M30 28.59L22.45 21A11 11 0 1 0 21 22.45L28.59 30zM5 14a9 9 0 1 1 9 9a9 9 0 0 1-9-9z"
							fill="currentColor"
						/></svg
					>
				</button>
			</div>
		</form>
	</div>
</div>
