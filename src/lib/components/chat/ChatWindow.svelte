<script lang="ts">
	import type { Message } from "$lib/types/Message";
	import { createEventDispatcher } from "svelte";

	import CarbonSendAltFilled from "~icons/carbon/send-alt-filled";
	import CarbonExport from "~icons/carbon/export";

	import ChatMessages from "./ChatMessages.svelte";
	import ChatInput from "./ChatInput.svelte";
	import StopGeneratingBtn from "../StopGeneratingBtn.svelte";
	import { PUBLIC_MODEL_ID, PUBLIC_MODEL_NAME } from "$env/static/public";

	export let messages: Message[] = [];
	export let disabled: boolean = false;
	export let loading: boolean = false;
	export let pending: boolean = false;

	let message: string;

	const dispatch = createEventDispatcher<{ message: string; share: void; stop: void }>();

	const handleSubmit = () => {
		if (loading) return;
		dispatch("message", message);
		message = "";
	};
</script>

<div class="relative min-h-0 min-w-0">
	<ChatMessages {loading} {pending} {messages} on:message />
	<div
		class="flex flex-col pointer-events-none [&>*]:pointer-events-auto max-md:border-t dark:border-gray-800 items-center max-md:dark:bg-gray-900 max-md:bg-white bg-gradient-to-t from-white via-white/80 to-white/0 dark:from-gray-900 dark:via-gray-80 dark:to-gray-900/0 justify-center absolute inset-x-0 max-w-3xl xl:max-w-4xl mx-auto px-3.5 sm:px-5 bottom-0 py-4 md:py-8 w-full z-0"
	>
		<StopGeneratingBtn
			visible={loading}
			className="right-5 mr-[1px] md:mr-0 md:right-7 top-6 md:top-10 z-10"
			on:click={() => dispatch("stop")}
		/>
		<form
			on:submit|preventDefault={handleSubmit}
			class="w-full relative flex items-center rounded-xl flex-1 max-w-4xl border bg-gray-100 focus-within:border-gray-300 dark:bg-gray-700 dark:border-gray-600 dark:focus-within:border-gray-500 "
		>
			<div class="w-full flex flex-1 border-none bg-transparent">
				<ChatInput
					placeholder="Ask anything"
					bind:value={message}
					on:submit={handleSubmit}
					autofocus
					maxRows={10}
				/>
				<button
					class="btn p-1 px-[0.7rem] self-end bg-transparent my-1 h-[2.4rem] text-gray-400 rounded-lg enabled:dark:hover:text-gray-100 enabled:hover:text-gray-700 disabled:opacity-60 dark:disabled:opacity-40 mx-1"
					disabled={!message || loading || disabled}
					type="submit"
				>
					<CarbonSendAltFilled />
				</button>
			</div>
		</form>
		<div class="flex text-xs text-gray-400/90 mt-2 justify-between self-stretch px-1 max-sm:gap-2">
			<p>
				Model: <a
					href="https://huggingface.co/{PUBLIC_MODEL_ID}"
					target="_blank"
					rel="noreferrer"
					class="hover:underline">{PUBLIC_MODEL_NAME}</a
				> <span class="max-sm:hidden">·</span><br class="sm:hidden" /> Generated content may be inaccurate
				or false.
			</p>
			{#if messages.length}
				<button
					class="flex flex-none items-center hover:underline hover:text-gray-400 dark:max-sm:bg-gray-800 max-sm:bg-gray-50 max-sm:px-2.5 max-sm:rounded-lg"
					type="button"
					on:click={() => dispatch("share")}
				>
					<CarbonExport class="text-[.6rem] sm:mr-1.5 sm:text-yellow-500" />
					<div class="max-sm:hidden">Share this conversation</div>
				</button>
			{/if}
		</div>
	</div>
</div>
