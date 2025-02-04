<script lang="ts">
	import type { Message } from "$lib/types/Message";
	import { afterUpdate, createEventDispatcher, tick } from "svelte";
	import { deepestChild } from "$lib/utils/deepestChild";
	import { page } from "$app/stores";

	import CopyToClipBoardBtn from "../CopyToClipBoardBtn.svelte";
	import IconLoading from "../icons/IconLoading.svelte";
	import CarbonRotate360 from "~icons/carbon/rotate-360";
	import CarbonDownload from "~icons/carbon/download";

	import CarbonPen from "~icons/carbon/pen";
	import UploadedFile from "./UploadedFile.svelte";

	import OpenWebSearchResults from "../OpenWebSearchResults.svelte";
	import {
		MessageUpdateType,
		MessageWebSearchUpdateType,
		type MessageToolUpdate,
		type MessageWebSearchSourcesUpdate,
		type MessageWebSearchUpdate,
		type MessageFinalAnswerUpdate,
		type MessageReasoningUpdate,
		MessageReasoningUpdateType,
	} from "$lib/types/MessageUpdate";
	import { base } from "$app/paths";
	import ToolUpdate from "./ToolUpdate.svelte";
	import { useSettingsStore } from "$lib/stores/settings";
	import MarkdownRenderer from "./MarkdownRenderer.svelte";
	import OpenReasoningResults from "./OpenReasoningResults.svelte";
	import Alternatives from "./Alternatives.svelte";
	import Vote from "./Vote.svelte";

	export let message: Message;
	export let loading = false;
	export let isAuthor = true;
	export let readOnly = false;
	export let isTapped = false;
	export let alternatives: Message["id"][] = [];
	export let editMsdgId: Message["id"] | null = null;
	export let isLast = false;

	const dispatch = createEventDispatcher<{
		retry: { content?: string; id: Message["id"] };
	}>();

	let contentEl: HTMLElement;
	let loadingEl: IconLoading;
	let pendingTimeout: ReturnType<typeof setTimeout>;
	let isCopied = false;

	$: emptyLoad =
		!message.content && (webSearchIsDone || (searchUpdates && searchUpdates.length === 0));

	const settings = useSettingsStore();

	afterUpdate(() => {
		if ($settings.disableStream) {
			return;
		}

		loadingEl?.$destroy();
		clearTimeout(pendingTimeout);

		// Add loading animation to the last message if update takes more than 600ms
		if (isLast && loading && emptyLoad) {
			pendingTimeout = setTimeout(() => {
				if (contentEl) {
					loadingEl = new IconLoading({
						target: deepestChild(contentEl),
						props: { classNames: "loading inline ml-2 first:ml-0" },
					});
				}
			}, 600);
		}
	});

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
			editFormEl.requestSubmit();
		}
	}

	$: searchUpdates = (message.updates?.filter(({ type }) => type === MessageUpdateType.WebSearch) ??
		[]) as MessageWebSearchUpdate[];

	$: reasoningUpdates = (message.updates?.filter(
		({ type }) => type === MessageUpdateType.Reasoning
	) ?? []) as MessageReasoningUpdate[];

	$: messageFinalAnswer = message.updates?.find(
		({ type }) => type === MessageUpdateType.FinalAnswer
	) as MessageFinalAnswerUpdate;

	// filter all updates with type === "tool" then group them by uuid field

	$: toolUpdates = message.updates
		?.filter(({ type }) => type === "tool")
		.reduce((acc, update) => {
			if (update.type !== "tool") {
				return acc;
			}
			acc[update.uuid] = acc[update.uuid] ?? [];
			acc[update.uuid].push(update);
			return acc;
		}, {} as Record<string, MessageToolUpdate[]>);

	$: urlNotTrailing = $page.url.pathname.replace(/\/$/, "");
	$: downloadLink = urlNotTrailing + `/message/${message.id}/prompt`;

	let webSearchIsDone = true;

	$: webSearchIsDone = searchUpdates.some(
		(update) => update.subtype === MessageWebSearchUpdateType.Finished
	);

	$: webSearchSources = searchUpdates?.find(
		(update): update is MessageWebSearchSourcesUpdate =>
			update.subtype === MessageWebSearchUpdateType.Sources
	)?.sources;

	$: if (isCopied) {
		setTimeout(() => {
			isCopied = false;
		}, 1000);
	}

	$: editMode = editMsdgId === message.id;
	let editContentEl: HTMLTextAreaElement;
	let editFormEl: HTMLFormElement;

	$: if (editMode) {
		tick();
		if (editContentEl) {
			editContentEl.value = message.content;
			editContentEl?.focus();
		}
	}
</script>

{#if message.from === "assistant"}
	<div
		class="group relative -mb-4 flex items-start justify-start gap-4 pb-4 leading-relaxed"
		data-message-id={message.id}
		data-message-role="assistant"
		role="presentation"
		on:click={() => (isTapped = !isTapped)}
		on:keydown={() => (isTapped = !isTapped)}
	>
		{#if $page.data?.assistant?.avatar}
			<img
				src="{base}/settings/assistants/{$page.data.assistant._id}/avatar.jpg"
				alt="Avatar"
				class="mt-5 h-3 w-3 flex-none select-none rounded-full shadow-lg"
			/>
		{:else}
			<img
				alt=""
				src="https://huggingface.co/avatars/2edb18bd0206c16b433841a47f53fa8e.svg"
				class="mt-5 h-3 w-3 flex-none select-none rounded-full shadow-lg"
			/>
		{/if}
		<div
			class="relative min-h-[calc(2rem+theme(spacing[3.5])*2)] min-w-[60px] break-words rounded-2xl border border-gray-100 bg-gradient-to-br from-gray-50 px-5 py-3.5 text-gray-600 prose-pre:my-2 dark:border-gray-800 dark:from-gray-800/40 dark:text-gray-300"
		>
			{#if message.files?.length}
				<div class="flex h-fit flex-wrap gap-x-5 gap-y-2">
					{#each message.files as file}
						<UploadedFile {file} canClose={false} />
					{/each}
				</div>
			{/if}
			{#if searchUpdates && searchUpdates.length > 0}
				<OpenWebSearchResults webSearchMessages={searchUpdates} />
			{/if}
			{#if reasoningUpdates && reasoningUpdates.length > 0 && message.reasoning && message.reasoning.trim().length > 0}
				{@const summaries = reasoningUpdates
					.filter((u) => u.subtype === MessageReasoningUpdateType.Status)
					.map((u) => u.status)}

				<OpenReasoningResults
					summary={summaries[summaries.length - 1] || ""}
					content={message.reasoning || ""}
					loading={loading && message.content.length === 0}
				/>
			{/if}

			{#if toolUpdates}
				{#each Object.values(toolUpdates) as tool}
					{#if tool.length}
						{#key tool[0].uuid}
							<ToolUpdate {tool} {loading} />
						{/key}
					{/if}
				{/each}
			{/if}

			<div
				bind:this={contentEl}
				class:mt-2={reasoningUpdates.length > 0 || searchUpdates.length > 0}
			>
				{#if isLast && loading && $settings.disableStream}
					<IconLoading classNames="loading inline ml-2 first:ml-0" />
				{/if}

				<div
					class="prose max-w-none dark:prose-invert max-sm:prose-sm prose-headings:font-semibold prose-h1:text-lg prose-h2:text-base prose-h3:text-base prose-pre:bg-gray-800 dark:prose-pre:bg-gray-900"
				>
					<MarkdownRenderer content={message.content} sources={webSearchSources} />
				</div>
			</div>

			<!-- Web Search sources -->
			{#if webSearchSources?.length}
				<div class="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
					<div class="text-gray-400">Sources:</div>
					{#each webSearchSources as { link, title }}
						<a
							class="flex items-center gap-2 whitespace-nowrap rounded-lg border bg-white px-2 py-1.5 leading-none hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
							href={link}
							target="_blank"
						>
							<img
								class="h-3.5 w-3.5 rounded"
								src="https://www.google.com/s2/favicons?sz=64&domain_url={new URL(link).hostname ||
									'placeholder'}"
								alt="{title} favicon"
							/>
							<div>{new URL(link).hostname.replace(/^www\./, "")}</div>
						</a>
					{/each}
				</div>
			{/if}

			<!-- Endpoint web sources -->
			{#if messageFinalAnswer?.webSources && messageFinalAnswer.webSources.length}
				<div class="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
					<div class="text-gray-400">Sources:</div>
					{#each messageFinalAnswer.webSources as { uri, title }}
						<a
							class="flex items-center gap-2 whitespace-nowrap rounded-lg border bg-white px-2 py-1.5 leading-none hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
							href={uri}
							target="_blank"
						>
							<img
								class="h-3.5 w-3.5 rounded"
								src="https://www.google.com/s2/favicons?sz=64&domain_url={new URL(uri).hostname ||
									'placeholder'}"
								alt="{title} favicon"
							/>
							<div>{title}</div>
						</a>
					{/each}
				</div>
			{/if}
		</div>

		{#if !loading && (message.content || toolUpdates)}
			<div
				class="absolute -bottom-4 right-0 flex max-md:transition-all md:group-hover:visible md:group-hover:opacity-100
	{message.score ? 'visible opacity-100' : 'invisible max-md:-translate-y-4 max-md:opacity-0'}
	{isTapped || isCopied ? 'max-md:visible max-md:translate-y-0 max-md:opacity-100' : ''}
	"
			>
				{#if isAuthor}
					<Vote {message} on:vote />
				{/if}
				<button
					class="btn rounded-sm p-1 text-sm text-gray-400 hover:text-gray-500 focus:ring-0 dark:text-gray-400 dark:hover:text-gray-300"
					title="Retry"
					type="button"
					on:click={() => {
						dispatch("retry", { id: message.id });
					}}
				>
					<CarbonRotate360 />
				</button>
				<CopyToClipBoardBtn
					on:click={() => {
						isCopied = true;
					}}
					classNames="btn rounded-sm p-1 text-sm text-gray-400 hover:text-gray-500 focus:ring-0 dark:text-gray-400 dark:hover:text-gray-300"
					value={message.content}
				/>
			</div>
		{/if}
	</div>
	{#if alternatives.length > 1 && editMsdgId === null}
		<Alternatives {message} {alternatives} {loading} on:showAlternateMsg />
	{/if}
{/if}
{#if message.from === "user"}
	<div
		class="group relative w-full items-start justify-start gap-4 max-sm:text-sm"
		data-message-id={message.id}
		data-message-type="user"
		role="presentation"
		on:click={() => (isTapped = !isTapped)}
		on:keydown={() => (isTapped = !isTapped)}
	>
		<div class="flex w-full flex-col gap-2">
			{#if message.files?.length}
				<div class="flex w-fit gap-4 px-5">
					{#each message.files as file}
						<UploadedFile {file} canClose={false} />
					{/each}
				</div>
			{/if}

			<div class="flex w-full flex-row flex-nowrap">
				{#if !editMode}
					<p
						class="disabled w-full appearance-none whitespace-break-spaces text-wrap break-words bg-inherit px-5 py-3.5 text-gray-500 dark:text-gray-400"
					>
						{message.content.trim()}
					</p>
				{:else}
					<form
						class="flex w-full flex-col"
						bind:this={editFormEl}
						on:submit|preventDefault={() => {
							dispatch("retry", { content: editContentEl.value, id: message.id });
							editMsdgId = null;
						}}
					>
						<textarea
							class="w-full whitespace-break-spaces break-words rounded-xl bg-gray-100 px-5 py-3.5 text-gray-500 *:h-max dark:bg-gray-800 dark:text-gray-400"
							rows="5"
							bind:this={editContentEl}
							value={message.content.trim()}
							on:keydown={handleKeyDown}
							required
						/>
						<div class="flex w-full flex-row flex-nowrap items-center justify-center gap-2 pt-2">
							<button
								type="submit"
								class="btn rounded-lg px-3 py-1.5 text-sm
                                {loading
									? 'bg-gray-300 text-gray-400 dark:bg-gray-700 dark:text-gray-600'
									: 'bg-gray-200 text-gray-600 hover:text-gray-800   focus:ring-0 dark:bg-gray-800 dark:text-gray-300 dark:hover:text-gray-200'}
								"
								disabled={loading}
							>
								Submit
							</button>
							<button
								type="button"
								class="btn rounded-sm p-2 text-sm text-gray-400 hover:text-gray-500 focus:ring-0 dark:text-gray-400 dark:hover:text-gray-300"
								on:click={() => {
									editMsdgId = null;
								}}
							>
								Cancel
							</button>
						</div>
					</form>
				{/if}
				{#if !loading && !editMode}
					<div
						class="
                        max-md:opacity-0' invisible absolute
                        right-0 top-3.5 z-10 h-max max-md:-translate-y-4 max-md:transition-all md:bottom-0 md:group-hover:visible md:group-hover:opacity-100 {isTapped ||
						isCopied
							? 'max-md:visible max-md:translate-y-0 max-md:opacity-100'
							: ''}"
					>
						<div class="mx-auto flex flex-row flex-nowrap gap-2">
							<a
								class="rounded-lg border border-gray-100 bg-gray-100 p-1 text-xs text-gray-400 group-hover:block hover:text-gray-500 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-400 dark:hover:text-gray-300 max-sm:!hidden md:hidden"
								title="Download prompt and parameters"
								type="button"
								target="_blank"
								href={downloadLink}
							>
								<CarbonDownload />
							</a>
							{#if !readOnly}
								<button
									class="cursor-pointer rounded-lg border border-gray-100 bg-gray-100 p-1 text-xs text-gray-400 group-hover:block hover:text-gray-500 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-400 dark:hover:text-gray-300 md:hidden lg:-right-2"
									title="Branch"
									type="button"
									on:click={() => (editMsdgId = message.id)}
								>
									<CarbonPen />
								</button>
							{/if}
						</div>
					</div>
				{/if}
			</div>
			{#if alternatives.length > 1 && editMsdgId === null}
				<Alternatives {message} {alternatives} {loading} on:showAlternateMsg />
			{/if}
		</div>
	</div>
{/if}

<style>
	@keyframes loading {
		to {
			stroke-dashoffset: 122.9;
		}
	}
</style>
