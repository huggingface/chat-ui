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
		class="dark:via-gray-80 pointer-events-none absolute inset-x-0 bottom-0 z-0 mx-auto flex w-full max-w-3xl flex-col items-center justify-center bg-gradient-to-t from-white via-white/80 to-white/0 px-3.5 py-4 dark:border-gray-800 dark:from-gray-900 dark:to-gray-900/0 max-md:border-t max-md:bg-white max-md:dark:bg-gray-900 sm:px-5 md:py-8 xl:max-w-4xl [&>*]:pointer-events-auto"
	>
		<StopGeneratingBtn
			visible={loading}
			className="right-5 mr-[1px] md:mr-0 md:right-7 top-6 md:top-10 z-10"
			on:click={() => dispatch("stop")}
		/>
		<form
			on:submit|preventDefault={handleSubmit}
			class="relative flex w-full max-w-4xl flex-1 items-center rounded-xl border bg-gray-100 focus-within:border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:focus-within:border-gray-500 "
		>
			<div class="flex w-full flex-1 border-none bg-transparent">
				<ChatInput
					placeholder="Ask anything"
					bind:value={message}
					on:submit={handleSubmit}
					autofocus
					maxRows={10}
				/>
				<button
					class="btn mx-1 my-1 h-[2.4rem] self-end rounded-lg bg-transparent p-1 px-[0.7rem] text-gray-400 disabled:opacity-60 enabled:hover:text-gray-700 dark:disabled:opacity-40 enabled:dark:hover:text-gray-100"
					disabled={!message || loading || disabled}
					type="submit"
				>
					<CarbonSendAltFilled />
				</button>
			</div>
		</form>
		<div class="mt-2 flex justify-between self-stretch px-1 text-xs text-gray-400/90 max-sm:gap-2">
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
					class="flex flex-none items-center hover:text-gray-400 hover:underline max-sm:rounded-lg max-sm:bg-gray-50 max-sm:px-2.5 dark:max-sm:bg-gray-800"
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
