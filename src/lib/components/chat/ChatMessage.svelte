<script lang="ts">
	import { marked, type MarkedOptions } from "marked";
	import markedKatex from "marked-katex-extension";
	import type { Message, MessageFile } from "$lib/types/Message";
	import { afterUpdate, createEventDispatcher, onMount, tick } from "svelte";
	import { deepestChild } from "$lib/utils/deepestChild";
	import { page } from "$app/stores";

	import CodeBlock from "../CodeBlock.svelte";
	import CopyToClipBoardBtn from "../CopyToClipBoardBtn.svelte";
	import IconLoading from "../icons/IconLoading.svelte";
	import CarbonRotate360 from "~icons/carbon/rotate-360";
	import CarbonDownload from "~icons/carbon/download";
	import CarbonThumbsUp from "~icons/carbon/thumbs-up";
	import CarbonThumbsDown from "~icons/carbon/thumbs-down";
	import CarbonPen from "~icons/carbon/pen";
	import CarbonChevronLeft from "~icons/carbon/chevron-left";
	import CarbonChevronRight from "~icons/carbon/chevron-right";
	import CarbonTools from "~icons/carbon/tools";
	import { PUBLIC_SEP_TOKEN } from "$lib/constants/publicSepToken";
	import type { Model } from "$lib/types/Model";
	import UploadedFile from "./UploadedFile.svelte";

	import OpenWebSearchResults from "../OpenWebSearchResults.svelte";
	import {
		MessageToolUpdateType,
		MessageWebSearchUpdateType,
		type MessageToolUpdate,
		type MessageWebSearchSourcesUpdate,
		type MessageWebSearchUpdate,
	} from "$lib/types/MessageUpdate";
	import {
		isMessageToolCallUpdate,
		isMessageToolResultUpdate,
		isMessageToolErrorUpdate,
	} from "$lib/utils/messageUpdates";
	import type { ToolFront } from "$lib/types/Tool";
	import { base } from "$app/paths";
	import { useConvTreeStore } from "$lib/stores/convTree";
	import { isReducedMotion } from "$lib/utils/isReduceMotion";
	import Modal from "../Modal.svelte";
	import { toolHasName } from "$lib/utils/tools";

	function sanitizeMd(md: string) {
		let ret = md
			.replace(/<\|[a-z]*$/, "")
			.replace(/<\|[a-z]+\|$/, "")
			.replace(/<$/, "")
			.replaceAll(PUBLIC_SEP_TOKEN, " ")
			.replaceAll(/<\|[a-z]+\|>/g, " ")
			.replaceAll(/<br\s?\/?>/gi, "\n")
			.replaceAll("<", "&lt;")
			.trim();

		for (const stop of [...(model.parameters?.stop ?? []), "<|endoftext|>"]) {
			if (ret.endsWith(stop)) {
				ret = ret.slice(0, -stop.length).trim();
			}
		}

		return ret;
	}
	function unsanitizeMd(md: string) {
		return md.replaceAll("&lt;", "<");
	}

	export let model: Model;
	export let id: Message["id"];
	export let messages: Message[];
	export let loading = false;
	export let isAuthor = true;
	export let readOnly = false;
	export let isTapped = false;

	$: message = messages.find((m) => m.id === id) ?? ({} as Message);

	$: urlNotTrailing = $page.url.pathname.replace(/\/$/, "");

	const dispatch = createEventDispatcher<{
		retry: { content?: string; id: Message["id"] };
		vote: { score: Message["score"]; id: Message["id"] };
	}>();

	let contentEl: HTMLElement;
	let loadingEl: IconLoading;
	let pendingTimeout: ReturnType<typeof setTimeout>;
	let isCopied = false;

	let initialized = false;

	let reducedMotionMode = false;

	const renderer = new marked.Renderer();
	// For code blocks with simple backticks
	renderer.codespan = (code) => {
		// Unsanitize double-sanitized code
		return `<code>${code.replaceAll("&amp;", "&")}</code>`;
	};

	renderer.link = (href, title, text) => {
		return `<a href="${href?.replace(/>$/, "")}" target="_blank" rel="noreferrer">${text}</a>`;
	};

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { extensions, ...defaults } = marked.getDefaults() as MarkedOptions & {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		extensions: any;
	};
	const options: MarkedOptions = {
		...defaults,
		gfm: true,
		breaks: true,
		renderer,
	};

	marked.use(
		markedKatex({
			throwOnError: false,
			// output: "html",
		})
	);

	$: tokens = marked.lexer(sanitizeMd(message.content));

	$: emptyLoad =
		!message.content && (webSearchIsDone || (searchUpdates && searchUpdates.length === 0));

	onMount(() => {
		reducedMotionMode = isReducedMotion(window);
	});

	afterUpdate(() => {
		if (reducedMotionMode) {
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

	$: searchUpdates = (message.updates?.filter(({ type }) => type === "webSearch") ??
		[]) as MessageWebSearchUpdate[];

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

	$: editMode = $convTreeStore.editing === message.id;
	let editContentEl: HTMLTextAreaElement;
	let editFormEl: HTMLFormElement;

	$: if (editMode) {
		tick();
		if (editContentEl) {
			editContentEl.value = message.content;
			editContentEl?.focus();
		}
	}

	$: isLast = (message && message.children?.length === 0) ?? false;

	$: childrenToRender = 0;
	$: nChildren = message?.children?.length ?? 0;

	$: {
		if (initialized) {
			childrenToRender = Math.max(0, nChildren - 1);
		} else {
			childrenToRender = 0;
			initialized = true;
		}
	}
	const convTreeStore = useConvTreeStore();

	$: if (message.children?.length === 0) $convTreeStore.leaf = message.id;

	$: modalImageToShow = null as MessageFile | null;

	const availableTools: ToolFront[] = $page.data.tools;
</script>

{#if modalImageToShow}
	<!-- show the image file full screen, click outside to exit -->
	<Modal width="sm:max-w-[500px]" on:close={() => (modalImageToShow = null)}>
		{#if modalImageToShow.type === "hash"}
			<img
				src={urlNotTrailing + "/output/" + modalImageToShow.value}
				alt="input from user"
				class="aspect-auto"
			/>
		{:else}
			<!-- handle the case where this is a base64 encoded image -->
			<img
				src={`data:${modalImageToShow.mime};base64,${modalImageToShow.value}`}
				alt="input from user"
				class="aspect-auto"
			/>
		{/if}
	</Modal>
{/if}

{#if message.from === "assistant"}
	<div
		class="group relative -mb-6 flex items-start justify-start gap-4 pb-4 leading-relaxed"
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
						<!-- handle the case where this is a hash that points to an image in the db, hash is always 64 char long -->
						<button on:click={() => (modalImageToShow = file)}>
							{#if file.type === "hash"}
								<img
									src={urlNotTrailing + "/output/" + file.value}
									alt="output from assistant"
									class="my-2 aspect-auto max-h-48 cursor-pointer rounded-lg shadow-lg"
								/>
							{:else}
								<!-- handle the case where this is a base64 encoded image -->
								<img
									src={`data:${file.mime};base64,${file.value}`}
									alt="output from assistant"
									class="my-2 aspect-auto max-h-48 cursor-pointer rounded-lg shadow-lg"
								/>
							{/if}
						</button>
					{/each}
				</div>
			{/if}
			{#if searchUpdates && searchUpdates.length > 0}
				<OpenWebSearchResults
					classNames={tokens.length ? "mb-3.5" : ""}
					webSearchMessages={searchUpdates}
				/>
			{/if}

			{#if toolUpdates}
				{#each Object.values(toolUpdates) as tool}
					{#if tool.length}
						{@const toolName = tool.find(isMessageToolCallUpdate)?.call.name}
						{@const toolError = tool.some(isMessageToolErrorUpdate)}
						{@const toolDone = tool.some(isMessageToolResultUpdate)}
						{#if toolName && toolName !== "websearch"}
							<details
								class="group/tool my-2.5 w-fit cursor-pointer rounded-lg border border-gray-200 bg-white pl-1 pr-2.5 text-sm shadow-sm transition-all open:mb-3
								open:border-purple-500/10 open:bg-purple-600/5 open:shadow-sm dark:border-gray-800 dark:bg-gray-900 open:dark:border-purple-800/40 open:dark:bg-purple-800/10"
							>
								<summary
									class="flex select-none list-none items-center gap-1.5 py-1 group-open/tool:text-purple-700 group-open/tool:dark:text-purple-300"
								>
									<div
										class="relative grid size-[22px] place-items-center rounded bg-purple-600/10 dark:bg-purple-600/20"
									>
										<svg
											class="absolute inset-0 text-purple-500/40 transition-opacity"
											class:invisible={toolDone || toolError}
											width="22"
											height="22"
											viewBox="0 0 38 38"
											fill="none"
											xmlns="http://www.w3.org/2000/svg"
										>
											<path
												class="loading-path"
												d="M8 2.5H30C30 2.5 35.5 2.5 35.5 8V30C35.5 30 35.5 35.5 30 35.5H8C8 35.5 2.5 35.5 2.5 30V8C2.5 8 2.5 2.5 8 2.5Z"
												stroke="currentColor"
												stroke-width="1"
												stroke-linecap="round"
												id="shape"
											/>
										</svg>
										<CarbonTools class="text-xs text-purple-700 dark:text-purple-500" />
									</div>

									<span>
										{toolError ? "Error calling" : toolDone ? "Called" : "Calling"} tool
										<span class="font-semibold"
											>{availableTools.find((el) => toolHasName(toolName, el))?.displayName}</span
										>
									</span>
								</summary>
								{#each tool as toolUpdate}
									{#if toolUpdate.subtype === MessageToolUpdateType.Call}
										<div class="mt-1 flex items-center gap-2 opacity-80">
											<h3 class="text-sm">Parameters</h3>
											<div class="h-px flex-1 bg-gradient-to-r from-gray-500/20" />
										</div>
										<ul class="py-1 text-sm">
											{#each Object.entries(toolUpdate.call.parameters ?? {}) as [k, v]}
												<li>
													<span class="font-semibold">{k}</span>:
													<span>{v}</span>
												</li>
											{/each}
										</ul>
									{:else if toolUpdate.subtype === MessageToolUpdateType.Error}
										<div class="mt-1 flex items-center gap-2 opacity-80">
											<h3 class="text-sm">Error</h3>
											<div class="h-px flex-1 bg-gradient-to-r from-gray-500/20" />
										</div>
										<p class="text-sm">{toolUpdate.message}</p>
									{/if}
								{/each}
							</details>
						{/if}
					{/if}
				{/each}
			{/if}

			<div
				class="prose max-w-none max-sm:prose-sm dark:prose-invert prose-headings:font-semibold prose-h1:text-lg prose-h2:text-base prose-h3:text-base prose-pre:bg-gray-800 dark:prose-pre:bg-gray-900"
				bind:this={contentEl}
			>
				{#if isLast && loading && reducedMotionMode}
					<IconLoading classNames="loading inline ml-2 first:ml-0" />
				{/if}
				{#each tokens as token}
					{#if token.type === "code"}
						<CodeBlock lang={token.lang} code={unsanitizeMd(token.text)} />
					{:else}
						<!-- eslint-disable-next-line svelte/no-at-html-tags -->
						{@html marked.parse(token.raw, options)}
					{/if}
				{/each}
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
								src="https://www.google.com/s2/favicons?sz=64&domain_url={new URL(link).hostname}"
								alt="{title} favicon"
							/>
							<div>{new URL(link).hostname.replace(/^www\./, "")}</div>
						</a>
					{/each}
				</div>
			{/if}
		</div>
		{#if !loading && (message.content || toolUpdates)}
			<div
				class="absolute bottom-1 right-0 -mb-4 flex max-md:transition-all md:bottom-0 md:group-hover:visible md:group-hover:opacity-100
		{message.score ? 'visible opacity-100' : 'invisible max-md:-translate-y-4 max-md:opacity-0'}
		{isTapped || isCopied ? 'max-md:visible max-md:translate-y-0 max-md:opacity-100' : ''}
		"
			>
				{#if isAuthor}
					<button
						class="btn rounded-sm p-1 text-sm text-gray-400 focus:ring-0 hover:text-gray-500 dark:text-gray-400 dark:hover:text-gray-300
					{message.score && message.score > 0
							? 'text-green-500 hover:text-green-500 dark:text-green-400 hover:dark:text-green-400'
							: ''}"
						title={message.score === 1 ? "Remove +1" : "+1"}
						type="button"
						on:click={() =>
							dispatch("vote", { score: message.score === 1 ? 0 : 1, id: message.id })}
					>
						<CarbonThumbsUp class="h-[1.14em] w-[1.14em]" />
					</button>
					<button
						class="btn rounded-sm p-1 text-sm text-gray-400 focus:ring-0 hover:text-gray-500 dark:text-gray-400 dark:hover:text-gray-300
					{message.score && message.score < 0
							? 'text-red-500 hover:text-red-500 dark:text-red-400 hover:dark:text-red-400'
							: ''}"
						title={message.score === -1 ? "Remove -1" : "-1"}
						type="button"
						on:click={() =>
							dispatch("vote", { score: message.score === -1 ? 0 : -1, id: message.id })}
					>
						<CarbonThumbsDown class="h-[1.14em] w-[1.14em]" />
					</button>
				{/if}
				<button
					class="btn rounded-sm p-1 text-sm text-gray-400 focus:ring-0 hover:text-gray-500 dark:text-gray-400 dark:hover:text-gray-300"
					title="Retry"
					type="button"
					on:click={() => dispatch("retry", { id: message.id })}
				>
					<CarbonRotate360 />
				</button>
				<CopyToClipBoardBtn
					on:click={() => {
						isCopied = true;
					}}
					classNames="ml-1.5 !rounded-sm !p-1 !text-sm !text-gray-400 focus:!ring-0 hover:!text-gray-500 dark:!text-gray-400 dark:hover:!text-gray-300 !border-none !shadow-none"
					value={message.content}
				/>
			</div>
		{/if}
	</div>
	<slot name="childrenNav" />
{/if}
{#if message.from === "user"}
	<div
		class="group relative w-full items-start justify-start gap-4 max-sm:text-sm"
		role="presentation"
		on:click={() => (isTapped = !isTapped)}
		on:keydown={() => (isTapped = !isTapped)}
	>
		<div class="flex w-full flex-col gap-2">
			{#if message.files?.length}
				<div class="flex w-fit gap-4 px-5">
					{#each message.files as file}
						{#if file.mime.startsWith("image/")}
							<button on:click={() => (modalImageToShow = file)}>
								<UploadedFile {file} canClose={false} />
							</button>
						{:else}
							<UploadedFile {file} canClose={false} />
						{/if}
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
							$convTreeStore.editing = null;
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
									: 'bg-gray-200 text-gray-600 focus:ring-0   hover:text-gray-800 dark:bg-gray-800 dark:text-gray-300 dark:hover:text-gray-200'}
								"
								disabled={loading}
							>
								Submit
							</button>
							<button
								type="button"
								class="btn rounded-sm p-2 text-sm text-gray-400 focus:ring-0 hover:text-gray-500 dark:text-gray-400 dark:hover:text-gray-300"
								on:click={() => {
									$convTreeStore.editing = null;
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
							{#if downloadLink}
								<a
									class="rounded-lg border border-gray-100 bg-gray-100 p-1 text-xs text-gray-400 group-hover:block hover:text-gray-500 max-sm:!hidden md:hidden dark:border-gray-800 dark:bg-gray-800 dark:text-gray-400 dark:hover:text-gray-300"
									title="Download prompt and parameters"
									type="button"
									target="_blank"
									href={downloadLink}
								>
									<CarbonDownload />
								</a>
							{/if}
							{#if !readOnly}
								<button
									class="cursor-pointer rounded-lg border border-gray-100 bg-gray-100 p-1 text-xs text-gray-400 group-hover:block hover:text-gray-500 md:hidden lg:-right-2 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-400 dark:hover:text-gray-300"
									title="Branch"
									type="button"
									on:click={() => ($convTreeStore.editing = message.id)}
								>
									<CarbonPen />
								</button>
							{/if}
						</div>
					</div>
				{/if}
			</div>
			<slot name="childrenNav" />
		</div>
	</div>
{/if}

{#if nChildren > 0}
	<svelte:self
		{loading}
		{messages}
		{isAuthor}
		{readOnly}
		{model}
		id={messages.find((m) => m.id === id)?.children?.[childrenToRender]}
		on:retry
		on:vote
		on:continue
	>
		<svelte:fragment slot="childrenNav">
			{#if nChildren > 1 && $convTreeStore.editing === null}
				<div
					class="font-white z-10 -mt-1 ml-3.5 mr-auto flex h-6 w-fit select-none flex-row items-center justify-center gap-1 text-sm"
				>
					<button
						class="inline text-lg font-thin text-gray-400 disabled:pointer-events-none disabled:opacity-25 hover:text-gray-800 dark:text-gray-500 dark:hover:text-gray-200"
						on:click={() => (childrenToRender = Math.max(0, childrenToRender - 1))}
						disabled={childrenToRender === 0 || loading}
					>
						<CarbonChevronLeft class="text-sm" />
					</button>
					<span class=" text-gray-400 dark:text-gray-500">
						{childrenToRender + 1} / {nChildren}
					</span>
					<button
						class="inline text-lg font-thin text-gray-400 disabled:pointer-events-none disabled:opacity-25 hover:text-gray-800 dark:text-gray-500 dark:hover:text-gray-200"
						on:click={() =>
							(childrenToRender = Math.min(
								message?.children?.length ?? 1 - 1,
								childrenToRender + 1
							))}
						disabled={childrenToRender === nChildren - 1 || loading}
					>
						<CarbonChevronRight class="text-sm" />
					</button>
				</div>
			{/if}
		</svelte:fragment>
	</svelte:self>
{/if}

<style>
	details summary::-webkit-details-marker {
		display: none;
	}

	.loading-path {
		stroke-dasharray: 61.45;
		animation: loading 2s linear infinite;
	}

	@keyframes loading {
		to {
			stroke-dashoffset: 122.9;
		}
	}
</style>
