<script lang="ts">
	import type { Message } from "$lib/types/Message";
	import { tick } from "svelte";

	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";
	const publicConfig = usePublicConfig();
	import CopyToClipBoardBtn from "../CopyToClipBoardBtn.svelte";
	import IconLoading from "../icons/IconLoading.svelte";
	import CarbonRotate360 from "~icons/carbon/rotate-360";
	// import CarbonDownload from "~icons/carbon/download";

	import CarbonPen from "~icons/carbon/pen";
	import UploadedFile from "./UploadedFile.svelte";

	import {
		MessageUpdateType,
		type MessageReasoningUpdate,
		MessageReasoningUpdateType,
		type MessageToolUpdate,
	} from "$lib/types/MessageUpdate";
	import MarkdownRenderer from "./MarkdownRenderer.svelte";
	import OpenReasoningResults from "./OpenReasoningResults.svelte";
	import Alternatives from "./Alternatives.svelte";
	import MessageAvatar from "./MessageAvatar.svelte";
	import ToolUpdate from "./ToolUpdate.svelte";

	interface Props {
		message: Message;
		loading?: boolean;
		isAuthor?: boolean;
		readOnly?: boolean;
		isTapped?: boolean;
		alternatives?: Message["id"][];
		editMsdgId?: Message["id"] | null;
		isLast?: boolean;
		onretry?: (payload: { id: Message["id"]; content?: string }) => void;
		onshowAlternateMsg?: (payload: { id: Message["id"] }) => void;
	}

	let {
		message,
		loading = false,
		isAuthor: _isAuthor = true,
		readOnly: _readOnly = false,
		isTapped = $bindable(false),
		alternatives = [],
		editMsdgId = $bindable(null),
		isLast = false,
		onretry,
		onshowAlternateMsg,
	}: Props = $props();

	let contentEl: HTMLElement | undefined = $state();
	let isCopied = $state(false);
	let messageWidth: number = $state(0);
	let messageInfoWidth: number = $state(0);

	$effect(() => {
		// referenced to appease linter for currently-unused props
		void _isAuthor;
		void _readOnly;
	});

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
			editFormEl?.requestSubmit();
		}
		if (e.key === "Escape") {
			editMsdgId = null;
		}
	}

	let editContentEl: HTMLTextAreaElement | undefined = $state();
	let editFormEl: HTMLFormElement | undefined = $state();

	let reasoningUpdates = $derived(
		(message.updates?.filter(({ type }) => type === MessageUpdateType.Reasoning) ??
			[]) as MessageReasoningUpdate[]
	);

	let toolUpdateGroups = $derived.by(() => {
		const updates = message.updates?.filter((update) => update.type === MessageUpdateType.Tool) as
			| MessageToolUpdate[]
			| undefined;
		if (!updates || updates.length === 0) return [] as MessageToolUpdate[][];
		const grouped = new Map<string, MessageToolUpdate[]>();
		for (const update of updates) {
			if (!grouped.has(update.uuid)) {
				grouped.set(update.uuid, []);
			}
			grouped.get(update.uuid)?.push(update);
		}
		return Array.from(grouped.values());
	});

	let hasToolUpdates = $derived(toolUpdateGroups.length > 0);

	// const messageFinalAnswer = $derived(
	// 	message.updates?.find(
	// 		({ type }) => type === MessageUpdateType.FinalAnswer
	// 	) as MessageFinalAnswerUpdate
	// );
	// const urlNotTrailing = $derived(page.url.pathname.replace(/\/$/, ""));
	// let downloadLink = $derived(urlNotTrailing + `/message/${message.id}/prompt`);

	// Zero-config reasoning autodetection: detect <think> blocks in content
	const THINK_BLOCK_REGEX = /(<think>[\s\S]*?(?:<\/think>|$))/g;
	let thinkSegments = $derived.by(() => message.content.split(THINK_BLOCK_REGEX));
	let hasServerReasoning = $derived(
		reasoningUpdates &&
			reasoningUpdates.length > 0 &&
			!!message.reasoning &&
			message.reasoning.trim().length > 0
	);
	let hasClientThink = $derived(!hasServerReasoning && thinkSegments.length > 1);
	let formattedSources = $derived.by(() =>
		(message.sources ?? []).map((source) => {
			let hostname = source.link;
			let faviconOrigin = source.link;
			try {
				const parsed = new URL(source.link);
				hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
				faviconOrigin = parsed.origin;
			} catch {
				// keep raw values if parsing fails
			}
			return { ...source, hostname, faviconOrigin };
		})
	);

	$effect(() => {
		if (isCopied) {
			setTimeout(() => {
				isCopied = false;
			}, 1000);
		}
	});

	let editMode = $derived(editMsdgId === message.id);
	$effect(() => {
		if (editMode) {
			tick();
			if (editContentEl) {
				editContentEl.value = message.content;
				editContentEl?.focus();
			}
		}
	});
</script>

{#if message.from === "assistant"}
	<div
		bind:offsetWidth={messageWidth}
		class="group relative -mb-4 flex w-fit max-w-full items-start justify-start gap-4 pb-4 leading-relaxed max-sm:mb-1 {message.routerMetadata &&
		messageInfoWidth >= messageWidth
			? 'mb-1'
			: ''}"
		data-message-id={message.id}
		data-message-role="assistant"
		role="presentation"
		onclick={() => (isTapped = !isTapped)}
		onkeydown={() => (isTapped = !isTapped)}
	>
		<MessageAvatar
			classNames="mt-5 size-3.5 flex-none select-none rounded-full shadow-lg max-sm:hidden"
			animating={isLast && loading}
		/>
		<div
			class="relative flex min-w-[60px] flex-col gap-2 break-words rounded-2xl border border-gray-100 bg-gradient-to-br from-gray-50 px-5 py-3.5 text-gray-600 prose-pre:my-2 dark:border-gray-800 dark:from-gray-800/80 dark:text-gray-300"
		>
			{#if message.files?.length}
				<div class="flex h-fit flex-wrap gap-x-5 gap-y-2">
					{#each message.files as file (file.value)}
						<UploadedFile {file} canClose={false} />
					{/each}
				</div>
			{/if}

			{#if hasServerReasoning}
				{@const summaries = reasoningUpdates
					.filter((u) => u.subtype === MessageReasoningUpdateType.Status)
					.map((u) => u.status)}

				<OpenReasoningResults
					summary={summaries[summaries.length - 1] || ""}
					content={message.reasoning || ""}
					loading={loading && message.content.length === 0}
				/>
			{/if}
			{#if hasToolUpdates}
				<ToolUpdate tools={toolUpdateGroups} {loading} />
			{/if}

			<div bind:this={contentEl}>
				{#if isLast && loading && message.content.length === 0}
					<IconLoading classNames="loading inline ml-2 first:ml-0" />
				{/if}

				{#if hasClientThink}
					{#each message.content.split(THINK_BLOCK_REGEX) as part, _i}
						{#if part && part.startsWith("<think>")}
							{@const isClosed = part.endsWith("</think>")}
							{@const thinkContent = part.slice(7, isClosed ? -8 : undefined)}
							{@const summary = isClosed
								? thinkContent.trim().split(/\n+/)[0] || "Reasoning"
								: "Thinking..."}

							<OpenReasoningResults
								{summary}
								content={thinkContent}
								loading={isLast && loading && !isClosed}
							/>
						{:else if part && part.trim().length > 0}
							<div
								class="prose max-w-none dark:prose-invert max-sm:prose-sm prose-headings:font-semibold prose-h1:text-lg prose-h2:text-base prose-h3:text-base prose-pre:bg-gray-800 dark:prose-pre:bg-gray-900"
							>
								<MarkdownRenderer
									content={part}
									sources={message.sources ?? []}
									loading={isLast && loading}
								/>
							</div>
						{/if}
					{/each}
				{:else}
					<div
						class="prose max-w-none dark:prose-invert max-sm:prose-sm prose-headings:font-semibold prose-h1:text-lg prose-h2:text-base prose-h3:text-base prose-pre:bg-gray-800 dark:prose-pre:bg-gray-900"
					>
						<MarkdownRenderer
							content={message.content}
							sources={message.sources ?? []}
							loading={isLast && loading}
						/>
					</div>
				{/if}
				{#if formattedSources.length}
					<div class="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
						<div class="text-gray-400">Sources:</div>
						{#each formattedSources as source, index}
							<a
								class="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-gray-100 bg-white px-2 py-1.5 leading-none hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
								href={source.link}
								target="_blank"
								rel="noopener noreferrer"
								title={source.link}
								aria-label={`Source ${index + 1}: ${source.hostname ?? source.link}`}
							>
								<img
									class="h-3.5 w-3.5 rounded"
									src={`https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(source.faviconOrigin ?? source.link)}`}
									alt=""
								/>
								<div class="text-gray-600 dark:text-gray-300">{source.hostname}</div>
								<span
									class="rounded bg-gray-100 px-1 text-[0.65rem] font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-300"
								>
									{index + 1}
								</span>
							</a>
						{/each}
					</div>
				{/if}
			</div>
		</div>

		{#if message.routerMetadata || (!loading && (message.content || hasToolUpdates))}
			<div
				class="absolute -bottom-3.5 {message.routerMetadata && messageInfoWidth > messageWidth
					? 'left-1 pl-1 lg:pl-7'
					: 'right-1'} flex max-w-[calc(100dvw-40px)] items-center gap-0.5 overflow-hidden"
				bind:offsetWidth={messageInfoWidth}
			>
				{#if message.routerMetadata && (!isLast || !loading)}
					<div
						class="mr-2 flex items-center gap-1.5 truncate whitespace-nowrap text-[.65rem] text-gray-400 dark:text-gray-400 sm:text-xs"
					>
						<span class="truncate rounded bg-gray-100 px-1 font-mono dark:bg-gray-800 sm:py-px">
							{message.routerMetadata.route}
						</span>
						<span class="text-gray-500">with</span>
						{#if publicConfig.isHuggingChat}
							<a
								href="/chat/settings/{message.routerMetadata.model}"
								class="truncate rounded bg-gray-100 px-1 font-mono hover:text-gray-500 dark:bg-gray-800 dark:hover:text-gray-300 sm:py-px"
							>
								{message.routerMetadata.model.split("/").pop()}
							</a>
						{:else}
							<span class="truncate rounded bg-gray-100 px-1.5 font-mono dark:bg-gray-800 sm:py-px">
								{message.routerMetadata.model.split("/").pop()}
							</span>
						{/if}
					</div>
				{/if}
				{#if !isLast || !loading}
					<CopyToClipBoardBtn
						onClick={() => {
							isCopied = true;
						}}
						classNames="btn rounded-sm p-1 text-sm text-gray-400 hover:text-gray-500 focus:ring-0 dark:text-gray-400 dark:hover:text-gray-300"
						value={message.content}
						iconClassNames="text-xs"
					/>
					<button
						class="btn rounded-sm p-1 text-xs text-gray-400 hover:text-gray-500 focus:ring-0 dark:text-gray-400 dark:hover:text-gray-300"
						title="Retry"
						type="button"
						onclick={() => {
							onretry?.({ id: message.id });
						}}
					>
						<CarbonRotate360 />
					</button>
					{#if alternatives.length > 1 && editMsdgId === null}
						<Alternatives
							{message}
							{alternatives}
							{loading}
							onshowAlternateMsg={(payload) => onshowAlternateMsg?.(payload)}
						/>
					{/if}
				{/if}
			</div>
		{/if}
	</div>
{/if}
{#if message.from === "user"}
	<div
		class="group relative {alternatives.length > 1 && editMsdgId === null
			? 'mb-7'
			: ''} w-full items-start justify-start gap-4 max-sm:text-sm"
		data-message-id={message.id}
		data-message-type="user"
		role="presentation"
		onclick={() => (isTapped = !isTapped)}
		onkeydown={() => (isTapped = !isTapped)}
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
						class="mt-3 flex w-full flex-col"
						bind:this={editFormEl}
						onsubmit={(e) => {
							e.preventDefault();
							onretry?.({ content: editContentEl?.value, id: message.id });
							editMsdgId = null;
						}}
					>
						<textarea
							class="w-full whitespace-break-spaces break-words rounded-xl bg-gray-100 px-5 py-3.5 text-gray-500 *:h-max focus:outline-none dark:bg-gray-800 dark:text-gray-400"
							rows="5"
							bind:this={editContentEl}
							value={message.content.trim()}
							onkeydown={handleKeyDown}
							required
						></textarea>
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
								Send
							</button>
							<button
								type="button"
								class="btn rounded-sm p-2 text-sm text-gray-400 hover:text-gray-500 focus:ring-0 dark:text-gray-400 dark:hover:text-gray-300"
								onclick={() => {
									editMsdgId = null;
								}}
							>
								Cancel
							</button>
						</div>
					</form>
				{/if}
			</div>
			<div class="absolute -bottom-4 ml-3.5 flex w-full gap-1.5">
				{#if alternatives.length > 1 && editMsdgId === null}
					<Alternatives
						{message}
						{alternatives}
						{loading}
						onshowAlternateMsg={(payload) => onshowAlternateMsg?.(payload)}
					/>
				{/if}
				{#if (alternatives.length > 1 && editMsdgId === null) || (!loading && !editMode)}
					<button
						class="hidden cursor-pointer items-center gap-1 rounded-md border border-gray-200 px-1.5 py-0.5 text-xs text-gray-400 group-hover:flex hover:flex hover:text-gray-500 dark:border-gray-700 dark:text-gray-400 dark:hover:text-gray-300 lg:-right-2"
						title="Edit"
						type="button"
						onclick={() => (editMsdgId = message.id)}
					>
						<CarbonPen />
						Edit
					</button>
				{/if}
			</div>
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
