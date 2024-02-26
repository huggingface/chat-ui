<script lang="ts">
	import type { Message } from "$lib/types/Message";
	import { createEventDispatcher, onDestroy, tick } from "svelte";

	import CarbonSendAltFilled from "~icons/carbon/send-alt-filled";
	import CarbonExport from "~icons/carbon/export";
	import CarbonStopFilledAlt from "~icons/carbon/stop-filled-alt";
	import CarbonClose from "~icons/carbon/close";
	import CarbonCheckmark from "~icons/carbon/checkmark";
	import CarbonCaretDown from "~icons/carbon/caret-down";

	import EosIconsLoading from "~icons/eos-icons/loading";

	import ChatInput from "./ChatInput.svelte";
	import StopGeneratingBtn from "../StopGeneratingBtn.svelte";
	import type { Model } from "$lib/types/Model";
	import WebSearchToggle from "../WebSearchToggle.svelte";
	import LoginModal from "../LoginModal.svelte";
	import { page } from "$app/stores";
	import FileDropzone from "./FileDropzone.svelte";
	import RetryBtn from "../RetryBtn.svelte";
	import UploadBtn from "../UploadBtn.svelte";
	import file2base64 from "$lib/utils/file2base64";
	import type { Assistant } from "$lib/types/Assistant";
	import { base } from "$app/paths";
	import ContinueBtn from "../ContinueBtn.svelte";
	import AssistantIntroduction from "./AssistantIntroduction.svelte";
	import ChatMessage from "./ChatMessage.svelte";
	import ScrollToBottomBtn from "../ScrollToBottomBtn.svelte";
	import { browser } from "$app/environment";
	import { snapScrollToBottom } from "$lib/actions/snapScrollToBottom";
	import SystemPromptModal from "../SystemPromptModal.svelte";
	import ChatIntroduction from "./ChatIntroduction.svelte";
	import { useConvTreeStore } from "$lib/stores/convTree";

	export let messages: Message[] = [];
	export let loading = false;
	export let pending = false;

	export let shared = false;
	export let currentModel: Model;
	export let models: Model[];
	export let assistant: Assistant | undefined = undefined;
	export let preprompt: string | undefined = undefined;
	export let files: File[] = [];

	$: isReadOnly = !models.some((model) => model.id === currentModel.id);

	let loginModalOpen = false;
	let message: string;
	let timeout: ReturnType<typeof setTimeout>;
	let isSharedRecently = false;
	$: $page.params.id && (isSharedRecently = false);

	const dispatch = createEventDispatcher<{
		message: string;
		share: void;
		stop: void;
		retry: { id: Message["id"]; content?: string };
		continue: { id: Message["id"] };
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

	const convTreeStore = useConvTreeStore();

	$: lastMessage = browser && (messages.find((m) => m.id == $convTreeStore.leaf) as Message);
	$: lastIsError = lastMessage && lastMessage.from === "user" && !loading;

	$: sources = files.map((file) => file2base64(file));

	function onShare() {
		dispatch("share");
		isSharedRecently = true;
		if (timeout) {
			clearTimeout(timeout);
		}
		timeout = setTimeout(() => {
			isSharedRecently = false;
		}, 2000);
	}

	onDestroy(() => {
		if (timeout) {
			clearTimeout(timeout);
		}
	});

	let chatContainer: HTMLElement;

	async function scrollToBottom() {
		await tick();
		chatContainer.scrollTop = chatContainer.scrollHeight;
	}

	// If last message is from user, scroll to bottom
	$: if (lastMessage && lastMessage.from === "user") {
		scrollToBottom();
	}
</script>

<div class="relative min-h-0 min-w-0">
	{#if loginModalOpen}
		<LoginModal
			on:close={() => {
				loginModalOpen = false;
			}}
		/>
	{/if}
	<div
		class="scrollbar-custom mr-1 h-full overflow-y-auto"
		use:snapScrollToBottom={messages.length ? [...messages] : false}
		bind:this={chatContainer}
	>
		<div class="mx-auto flex h-full max-w-3xl flex-col gap-6 px-5 pt-6 sm:gap-8 xl:max-w-4xl">
			{#if $page.data?.assistant}
				<a
					class="mx-auto flex items-center gap-1.5 rounded-full border border-gray-100 bg-gray-50 py-1 pl-1 pr-3 text-sm text-gray-800 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
					href="{base}/settings/assistants/{$page.data.assistant._id}"
				>
					{#if $page.data?.assistant.avatar}
						<img
							src="{base}/settings/assistants/{$page.data?.assistant._id.toString()}/avatar.jpg?hash=${$page
								.data.assistant.avatar}"
							alt="Avatar"
							class="size-5 rounded-full object-cover"
						/>
					{:else}
						<div
							class="flex size-6 items-center justify-center rounded-full bg-gray-300 font-bold uppercase text-gray-500"
						>
							{$page.data?.assistant.name[0]}
						</div>
					{/if}

					{$page.data.assistant.name}
				</a>
			{:else if preprompt && preprompt != currentModel.preprompt}
				<SystemPromptModal preprompt={preprompt ?? ""} />
			{/if}

			{#if messages.length > 0}
				<div class="flex h-max flex-col gap-6 pb-52">
					<ChatMessage
						{loading}
						{messages}
						id={messages[0].id}
						isAuthor={!shared}
						readOnly={isReadOnly}
						model={currentModel}
						on:retry
						on:vote
						on:continue
					/>
				</div>
			{:else if pending}
				<ChatMessage
					loading={true}
					messages={[
						{
							id: "0-0-0-0-0",
							content: "",
							from: "assistant",
							children: [],
						},
					]}
					id={"0-0-0-0-0"}
					isAuthor={!shared}
					readOnly={isReadOnly}
					model={currentModel}
				/>
			{:else if !assistant}
				<ChatIntroduction {models} {currentModel} on:message />
			{:else}
				<AssistantIntroduction {assistant} on:message />
			{/if}
		</div>
		<ScrollToBottomBtn
			class="bottom-36 right-4 max-md:hidden lg:right-10"
			scrollNode={chatContainer}
		/>
	</div>
	<div
		class="dark:via-gray-80 pointer-events-none absolute inset-x-0 bottom-0 z-0 mx-auto flex w-full max-w-3xl flex-col items-center justify-center bg-gradient-to-t from-white via-white/80 to-white/0 px-3.5 py-4 max-md:border-t max-md:bg-white sm:px-5 md:py-8 xl:max-w-4xl dark:border-gray-800 dark:from-gray-900 dark:to-gray-900/0 max-md:dark:bg-gray-900 [&>*]:pointer-events-auto"
	>
		{#if sources.length}
			<div class="flex flex-row flex-wrap justify-center gap-2.5 max-md:pb-3">
				{#each sources as source, index}
					{#await source then src}
						<div class="relative h-16 w-16 overflow-hidden rounded-lg shadow-lg">
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
		{/if}

		<div class="w-full">
			<div class="flex w-full pb-3">
				{#if $page.data.settings?.searchEnabled && !assistant}
					<WebSearchToggle />
				{/if}
				{#if loading}
					<StopGeneratingBtn classNames="ml-auto" on:click={() => dispatch("stop")} />
				{:else if lastIsError}
					<RetryBtn
						classNames="ml-auto"
						on:click={() => {
							if (lastMessage && lastMessage.ancestors) {
								dispatch("retry", {
									id: lastMessage.ancestors[lastMessage.ancestors.length - 1],
								});
							}
						}}
					/>
				{:else}
					<div class="ml-auto gap-2">
						{#if currentModel.multimodal}
							<UploadBtn bind:files classNames="ml-auto" />
						{/if}
						{#if messages && lastMessage && lastMessage.interrupted && !isReadOnly}
							<ContinueBtn
								on:click={() => {
									if (lastMessage && lastMessage.ancestors) {
										dispatch("continue", {
											id: lastMessage?.id,
										});
									}
								}}
							/>
						{/if}
					</div>
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
								on:beforeinput={(ev) => {
									if ($page.data.loginRequired) {
										ev.preventDefault();
										loginModalOpen = true;
									}
								}}
								maxRows={6}
								disabled={isReadOnly || lastIsError}
							/>
						{/if}

						{#if loading}
							<button
								class="btn mx-1 my-1 inline-block h-[2.4rem] self-end rounded-lg bg-transparent p-1 px-[0.7rem] text-gray-400 disabled:opacity-60 enabled:hover:text-gray-700 md:hidden dark:disabled:opacity-40 enabled:dark:hover:text-gray-100"
								on:click={() => dispatch("stop")}
							>
								<CarbonStopFilledAlt />
							</button>
							<div
								class="mx-1 my-1 hidden h-[2.4rem] items-center p-1 px-[0.7rem] text-gray-400 disabled:opacity-60 enabled:hover:text-gray-700 md:flex dark:disabled:opacity-40 enabled:dark:hover:text-gray-100"
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
					Model:
					{#if !assistant}
						<a href="{base}/settings/{currentModel.id}" class="hover:underline"
							>{currentModel.displayName}</a
						>{:else}
						{@const model = models.find((m) => m.id === assistant?.modelId)}
						<a
							href="{base}/settings/assistants/{assistant._id}"
							class="inline-flex items-center border-b hover:text-gray-600 dark:border-gray-700 dark:hover:text-gray-300"
							>{model?.displayName}<CarbonCaretDown class="text-xxs" /></a
						>{/if} <span class="max-sm:hidden">·</span><br class="sm:hidden" /> Generated content may
					be inaccurate or false.
				</p>
				{#if messages.length}
					<button
						class="flex flex-none items-center hover:text-gray-400 max-sm:rounded-lg max-sm:bg-gray-50 max-sm:px-2.5 dark:max-sm:bg-gray-800"
						type="button"
						class:hover:underline={!isSharedRecently}
						on:click={onShare}
						disabled={isSharedRecently}
					>
						{#if isSharedRecently}
							<CarbonCheckmark class="text-[.6rem] sm:mr-1.5 sm:text-green-600" />
							<div class="text-green-600 max-sm:hidden">Link copied to clipboard</div>
						{:else}
							<CarbonExport class="text-[.6rem] sm:mr-1.5 sm:text-primary-500" />
							<div class="max-sm:hidden">Share this conversation</div>
						{/if}
					</button>
				{/if}
			</div>
		</div>
	</div>
</div>
