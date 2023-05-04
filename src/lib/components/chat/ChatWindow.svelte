<script lang="ts">
	import type { Message } from "$lib/types/Message";
	import { createEventDispatcher } from "svelte";

	import CarbonSendAltFilled from "~icons/carbon/send-alt-filled";
	import CarbonExport from "~icons/carbon/export";

	import ChatMessages from "./ChatMessages.svelte";
	import ChatInput from "./ChatInput.svelte";
	import StopGeneratingBtn from "../StopGeneratingBtn.svelte";
	import type { Model } from "$lib/types/Model";
	import type { LayoutData } from "../../../routes/$types";

	export let messages: Message[] = [];
	export let disabled = false;
	export let loading = false;
	export let pending = false;
	export let currentModel: Model;
	export let models: Model[] | undefined = undefined;
	export let settings: LayoutData["settings"];

	let message: string;

	const dispatch = createEventDispatcher<{
		message: string;
		share: void;
		stop: void;
		retry: { id: Message["id"]; content: string };
	}>();

	const handleSubmit = () => {
		if (loading) return;
		dispatch("message", message);
		message = "";
	};
</script>

<div class="relative min-h-0 min-w-0">
	<ChatMessages
		{loading}
		{pending}
		{settings}
		{currentModel}
		{models}
		{messages}
		on:message
		on:retry={(ev) => {
			if (!loading) dispatch("retry", ev.detail);
		}}
	/>
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
					maxRows={4}
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
					href="https://huggingface.co/{currentModel.name}"
					target="_blank"
					rel="noreferrer"
					class="hover:underline">{currentModel.displayName}</a
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
