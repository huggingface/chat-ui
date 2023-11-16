<script lang="ts">
	import type { Message } from "$lib/types/Message";
	import { createEventDispatcher } from "svelte";

	import CarbonSendAltFilled from "~icons/carbon/send-alt-filled";
	import CarbonExport from "~icons/carbon/export";
	import CarbonStopFilledAlt from "~icons/carbon/stop-filled-alt";
	import CarbonClose from "~icons/carbon/close";

	import EosIconsLoading from "~icons/eos-icons/loading";

	import ChatMessages from "./ChatMessages.svelte";
	import ChatInput from "./ChatInput.svelte";
	import StopGeneratingBtn from "../StopGeneratingBtn.svelte";
	import type { Model } from "$lib/types/Model";
	import type { LayoutData } from "../../../routes/$types";
	import WebSearchToggle from "../WebSearchToggle.svelte";
	import LoginModal from "../LoginModal.svelte";
	import type { WebSearchUpdate } from "$lib/types/MessageUpdate";
	import { page } from "$app/stores";
	import DisclaimerModal from "../DisclaimerModal.svelte";
	import FileDropzone from "./FileDropzone.svelte";
	import RetryBtn from "../RetryBtn.svelte";
	import UploadBtn from "../UploadBtn.svelte";
	import file2base64 from "$lib/utils/file2base64";

	export let messages: Message[] = [];
	export let loading = false;
	export let pending = false;
	export let shared = false;
	export let currentModel: Model;
	export let models: Model[];
	export let settings: LayoutData["settings"];
	export let webSearchMessages: WebSearchUpdate[] = [];
	export let preprompt: string | undefined = undefined;
	export let files: File[] = [];

	$: isReadOnly = !models.some((model) => model.id === currentModel.id);

	let loginModalOpen = false;
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

	let lastTarget: EventTarget | null = null;

	let onDrag = false;

	const onDragEnter = (e: DragEvent) => {
		lastTarget = e.target;
		onDrag = true;
	};
	const onDragLeave = (e: DragEvent) => {
		if (e.target === lastTarget) {
			onDrag = false;
		}
	};
	const onDragOver = (e: DragEvent) => {
		e.preventDefault();
	};
	$: lastIsError = messages[messages.length - 1]?.from === "user" && !loading;

	$: sources = files.map((file) => file2base64(file));
</script>

<div class="relative min-h-0 min-w-0">
	{#if !settings.ethicsModalAcceptedAt}
		<DisclaimerModal {settings} />
	{:else if loginModalOpen}
		<LoginModal
			{settings}
			on:close={() => {
				loginModalOpen = false;
			}}
		/>
	{/if}
	<ChatMessages
		{loading}
		{pending}
		{settings}
		{currentModel}
		{models}
		{messages}
		readOnly={isReadOnly}
		isAuthor={!shared}
		{webSearchMessages}
		{preprompt}
		on:message={(ev) => {
			if ($page.data.loginRequired) {
				loginModalOpen = true;
			} else {
				dispatch("message", ev.detail);
			}
		}}
		on:vote
		on:retry={(ev) => {
			if (!loading) dispatch("retry", ev.detail);
		}}
	/>

	<div
		class="pointer-events-none absolute inset-x-0 bottom-0 z-0 mx-auto flex w-full max-w-3xl flex-col items-center justify-center md:px-5 md:py-8 xl:max-w-4xl [&>*]:pointer-events-auto"
	>
		<div class="flex flex-row flex-wrap justify-center gap-2.5 max-md:pb-3">
			{#each sources as source, index}
				{#await source then src}
					<div class="relative h-24 w-24 overflow-hidden rounded-lg shadow-lg">
						<img
							src={`data:image/*;base64,${src}`}
							alt="input content"
							class="h-full w-full rounded-lg bg-gray-400 object-cover dark:bg-gray-900"
						/>
						<!-- add a button on top that deletes this image from sources -->
						<button
							class="absolute left-1 top-1"
							on:click={() => {
								files = files.filter((_, i) => i !== index);
							}}
						>
							<CarbonClose class="text-md font-black text-gray-300  hover:text-gray-100" />
						</button>
					</div>
				{/await}
			{/each}
		</div>

		<div
			class="dark:via-gray-80 w-full bg-gradient-to-t from-white via-white/80 to-white/0 dark:border-gray-800 dark:from-gray-900 dark:to-gray-900/0 max-md:border-t max-md:bg-white max-md:px-4 max-md:dark:bg-gray-900"
		>
			<div class="flex w-full pb-3 max-md:pt-3">
				{#if settings?.searchEnabled}
					<WebSearchToggle />
				{/if}
				{#if loading}
					<StopGeneratingBtn classNames="ml-auto" on:click={() => dispatch("stop")} />
				{:else if lastIsError}
					<RetryBtn
						classNames="ml-auto"
						on:click={() =>
							dispatch("retry", {
								id: messages[messages.length - 1].id,
								content: messages[messages.length - 1].content,
							})}
					/>
				{:else if currentModel.multimodal}
					<UploadBtn bind:files classNames="ml-auto" />
				{/if}
			</div>
			<form
				on:dragover={onDragOver}
				on:dragenter={onDragEnter}
				on:dragleave={onDragLeave}
				tabindex="-1"
				aria-label="file dropzone"
				on:submit|preventDefault={handleSubmit}
				class="relative flex w-full max-w-4xl flex-1 items-center rounded-xl border bg-gray-100 focus-within:border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:focus-within:border-gray-500
			{isReadOnly ? 'opacity-30' : ''}"
			>
				{#if onDrag && currentModel.multimodal}
					<FileDropzone bind:files bind:onDrag />
				{:else}
					<div class="flex w-full flex-1 border-none bg-transparent">
						{#if lastIsError}
							<ChatInput value="Sorry, something went wrong. Please try again." disabled={true} />
						{:else}
							<ChatInput
								placeholder="Ask anything"
								bind:value={message}
								on:submit={handleSubmit}
								on:keypress={(ev) => {
									if ($page.data.loginRequired) {
										ev.preventDefault();
										loginModalOpen = true;
									}
								}}
								maxRows={4}
								disabled={isReadOnly || lastIsError}
							/>
						{/if}

						{#if loading}
							<button
								class="btn mx-1 my-1 inline-block h-[2.4rem] self-end rounded-lg bg-transparent p-1 px-[0.7rem] text-gray-400 disabled:opacity-60 enabled:hover:text-gray-700 dark:disabled:opacity-40 enabled:dark:hover:text-gray-100 md:hidden"
								on:click={() => dispatch("stop")}
							>
								<CarbonStopFilledAlt />
							</button>
							<div
								class="mx-1 my-1 hidden h-[2.4rem] items-center p-1 px-[0.7rem] text-gray-400 disabled:opacity-60 enabled:hover:text-gray-700 dark:disabled:opacity-40 enabled:dark:hover:text-gray-100 md:flex"
							>
								<EosIconsLoading />
							</div>
						{:else}
							<button
								class="btn mx-1 my-1 h-[2.4rem] self-end rounded-lg bg-transparent p-1 px-[0.7rem] text-gray-400 disabled:opacity-60 enabled:hover:text-gray-700 dark:disabled:opacity-40 enabled:dark:hover:text-gray-100"
								disabled={!message || isReadOnly}
								type="submit"
							>
								<CarbonSendAltFilled />
							</button>
						{/if}
					</div>
				{/if}
			</form>
			<div
				class="mt-2 flex justify-between self-stretch px-1 text-xs text-gray-400/90 max-md:mb-2 max-sm:gap-2"
			>
				<p>
					Model: <a
						href={currentModel.modelUrl || "https://huggingface.co/" + currentModel.name}
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
						<CarbonExport class="text-[.6rem] sm:mr-1.5 sm:text-primary-500" />
						<div class="max-sm:hidden">Share this conversation</div>
					</button>
				{/if}
			</div>
		</div>
	</div>
</div>
