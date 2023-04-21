<script lang="ts">
	import type { Message } from "$lib/types/Message";
	import { createEventDispatcher } from "svelte";

	import CarbonAdd from "~icons/carbon/add";
	import CarbonSendAltFilled from "~icons/carbon/send-alt-filled";
	import CarbonTextAlignJustify from "~icons/carbon/text-align-justify";

	import ChatMessages from "./ChatMessages.svelte";
	import ChatInput from "./ChatInput.svelte";

	export let messages: Message[] = [];
	export let disabled: boolean = false;
	export let loading: boolean = false;
	export let pending: boolean = false;

	let message: string;

	const dispatch = createEventDispatcher<{ message: string }>();
</script>

<div class="relative h-screen">
	<nav class="sm:hidden flex items-center h-12 border-b px-4 justify-between dark:border-gray-800">
		<button><CarbonTextAlignJustify /></button>
		<button>New Chat</button>
		<button><CarbonAdd /></button>
	</nav>
	<ChatMessages {loading} {pending} {messages} on:message />
	<div
		class="flex max-md:border-t dark:border-gray-800 items-center max-md:dark:bg-gray-900 max-md:bg-white bg-gradient-to-t from-white dark:from-gray-900 to-transparent justify-center absolute inset-x-0 max-w-3xl xl:max-w-4xl mx-auto px-5 bottom-0 py-4 md:py-8 w-full"
	>
		<form
			on:submit|preventDefault={() => {
				if (loading) return;
				dispatch("message", message);
				message = "";
			}}
			class="w-full relative flex items-center rounded-xl flex-1 max-w-4xl border bg-gray-100 focus-within:border-gray-300 dark:bg-gray-700 dark:border-gray-600 dark:focus-within:border-gray-500 "
		>
			<div class="w-full flex flex-1 border-none bg-transparent">
				<ChatInput placeholder="Ask anything" bind:value={message} autofocus maxRows={10} />
				<button
					class="p-1 px-[0.7rem] group self-end my-1 h-[2.4rem] rounded-lg hover:bg-gray-100 enabled:dark:hover:text-gray-400 dark:hover:bg-gray-900 disabled:hover:bg-transparent dark:disabled:hover:bg-transparent disabled:opacity-60 dark:disabled:opacity-40 flex-shrink-0 transition-all mx-1"
					disabled={!message || loading || disabled}
					type="submit"
				>
					<CarbonSendAltFilled
						class="text-gray-400 group-hover:text-gray-800 group-disabled:text-gray-300"
					/>
				</button>
			</div>
		</form>
	</div>
</div>
