<script lang="ts">
	import { onMount, afterUpdate } from 'svelte';
	import type { Message, MessageFile } from "$lib/types/Message";
	import type { Comment, DisplayComment } from "$lib/types/Comment";
	import { createEventDispatcher, onDestroy, tick } from "svelte";

	import * as TextQuote from 'dom-anchor-text-quote';
  	import * as TextPosition from 'dom-anchor-text-position';
	import wrapRangeText, { WrapperObject } from 'wrap-range-text';

	import CarbonSendAltFilled from "~icons/carbon/send-alt-filled";
	import CarbonStopFilledAlt from "~icons/carbon/stop-filled-alt";
	import CarbonEdit from "~icons/carbon/edit";
	import CarbonCaretDown from "~icons/carbon/caret-down";
	import CarbonTrashCan from "~icons/carbon/trash-can";
	import CarbonClose from "~icons/carbon/close";
	import CarbonSend from "~icons/carbon/send";

	import EosIconsLoading from "~icons/eos-icons/loading";

	import ChatInput from "./ChatInput.svelte";
	import StopGeneratingBtn from "../StopGeneratingBtn.svelte";
	import type { Model } from "$lib/types/Model";
	import WebSearchToggle from "../WebSearchToggle.svelte";
	import ToolsMenu from "../ToolsMenu.svelte";
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
	import UploadedFile from "./UploadedFile.svelte";
	import { useSettingsStore } from "$lib/stores/settings";
	import type { ToolFront } from "$lib/types/Tool";

	export let messages: Message[] = [];
	export let loading = false;
	export let pending = false;

	$: shared = $page.data.shared ?? false;
	export let currentModel: Model;
	export let models: Model[];
	export let assistant: Assistant | undefined = undefined;
	export let preprompt: string | undefined = undefined;
	export let files: File[] = [];

	$: isReadOnly = !models.some((model) => model.id === currentModel.id) || shared;

	let loginModalOpen = false;
	let message: string;
	let timeout: ReturnType<typeof setTimeout>;
	let isSharedRecently = false;
	$: $page.params.id && (isSharedRecently = false);
	let displayComments: DisplayComment[] = [];
	let currentConversationId: string | null = null;

	$: {
		if ($page.params.id !== currentConversationId) {
		currentConversationId = $page.params.id;
		fetchComments();
		}
	}


	async function fetchComments() {
		if (shared && currentConversationId) {
		try {
			const response = await fetch(`/conversation/${currentConversationId}/comments`);
			if (!response.ok) {
			throw new Error('Failed to fetch comments');
			}
			const comments: DisplayComment[] = await response.json();
			
			displayComments = comments.map((comment) => ({
				...comment,
				originalContent: comment.content,
				isPending: false
			}));

			// Schedule highlighting after the DOM has updated
			afterUpdate(() => {
				highlightComments();
			});
		} catch (error) {
			console.error("Error fetching comments:", error);
		}
		} else {
		// Clear comments if not shared or no conversation ID
		displayComments = [];
		}
	}

	onMount(() => {
		fetchComments();
	});

	function highlightComments() {
		displayComments.forEach(comment => {
		if (comment.textQuoteSelector) {
			const range = TextQuote.toRange(document.body, comment.textQuoteSelector);
			if (range) {
			const wrapper = document.createElement('mark');
			const wrappedRange = wrapRangeText(wrapper, range);
			comment.wrapperObject = wrappedRange;
			}
		}
		});
	}	

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

	const onPaste = (e: ClipboardEvent) => {
		if (!e.clipboardData) {
			return;
		}

		// paste of files
		const pastedFiles = Array.from(e.clipboardData.files);
		if (pastedFiles.length !== 0) {
			e.preventDefault();

			// filter based on activeMimeTypes, including wildcards
			const filteredFiles = pastedFiles.filter((file) => {
				return activeMimeTypes.some((mimeType: string) => {
					const [type, subtype] = mimeType.split("/");
					const [fileType, fileSubtype] = file.type.split("/");
					return type === fileType && (subtype === "*" || fileSubtype === subtype);
				});
			});

			files = [...files, ...filteredFiles];
		}
	};

	const convTreeStore = useConvTreeStore();

	$: lastMessage = browser && (messages.find((m) => m.id == $convTreeStore.leaf) as Message);
	$: lastIsError =
		lastMessage &&
		!loading &&
		(lastMessage.from === "user" ||
			lastMessage.updates?.findIndex((u) => u.type === "status" && u.status === "error") !== -1);

	$: sources = files?.map<Promise<MessageFile>>((file) =>
		file2base64(file).then((value) => ({ type: "base64", value, mime: file.type, name: file.name }))
	);

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

	const settings = useSettingsStore();

	// active tools are all the checked tools, either from settings or on by default
	$: activeTools = $page.data.tools.filter(
		(tool: ToolFront) => $settings?.tools?.[tool.name] ?? tool.isOnByDefault
	);
	$: activeMimeTypes = [
		...(!$page.data?.assistant && currentModel.tools
			? activeTools.flatMap((tool: ToolFront) => tool.mimeTypes ?? [])
			: []),
		...(currentModel.multimodal ? ["image/*"] : []),
	];

	$: isFileUploadEnabled = activeMimeTypes.length > 0;
	
	let sidebar: HTMLElement | null = null



	// Adds a new DisplayComment to the array, ready for authoring, but doesn't persist it yet
	function addComment() {
		console.log("Comment button clicked - addComment function called");
		
		const selection = window.getSelection();
		
		if (!selection || selection.rangeCount === 0) {
			alert("No Selection");
			return;
		}
		
		const range = selection.getRangeAt(0);
		const selectedText = range.toString().trim();
		
		if (selectedText === "") {
			alert("No Selection");
		} else {
			let quoteSelector = TextQuote.fromRange(document.body, range);
			let positionSelector = TextPosition.fromRange(document.body, range);

			
			// Create a new range from the quoteSelector
			const newRange = TextQuote.toRange(document.body, {
				exact: quoteSelector.exact,
				prefix: quoteSelector.prefix,
				suffix: quoteSelector.suffix
			});

			if (newRange) {
				console.log("New range created successfully");
				const wrapper = document.createElement('mark');
				const wrappedRange = wrapRangeText(wrapper, newRange);
				console.log('Wrapped nodes:', wrappedRange.nodes);

				
				// Create a new DisplayComment object
				const newDisplayComment: DisplayComment = {

					content: "",

					textQuoteSelector: {
						exact: quoteSelector.exact,
						prefix: quoteSelector.prefix,
						suffix: quoteSelector.suffix
					},
					textPositionSelector: {
						start: positionSelector.start,
						end: positionSelector.end
					},
					isPending: true,
					wrapperObject: wrappedRange,
					originalContent: "",
				
				};

			// Add the newDisplayComment to the array and sort
			displayComments = [...displayComments, newDisplayComment]
            .sort((a, b) => {
                const aStart = a.textPositionSelector?.start ?? 0;
                const bStart = b.textPositionSelector?.start ?? 0;
                return aStart - bStart;
            });

			console.log("New comment added:", newDisplayComment);

			} else {
				console.log("Failed to create new range");
			}
			

		}
	}

	// Handles posting a newly created comment or an update to an existing comment
	async function handlePostComment(displayComment: DisplayComment) {
		try {
			let response;
			const commentData = {
				content: displayComment.content,
				textQuoteSelector: displayComment.textQuoteSelector,
				textPositionSelector: displayComment.textPositionSelector,
			};

			if ('_id' in displayComment && displayComment._id) {
				// Update existing comment
				response = await fetch(`/conversation/${$page.params.id}/comments`, {
					method: 'PUT',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						...commentData,
						commentId: displayComment._id,
					}),
				});
			} else {
				// Create new comment
				response = await fetch(`/conversation/${$page.params.id}/comments`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify(commentData),
				});
			}

			if (!response.ok) {
				throw new Error('Failed to save comment');
			}

			const result = await response.json();

			// Update the displayComments array
			displayComments = displayComments.map(comment => 
				comment === displayComment 
					? { 
						...comment, 
						...commentData, 
						_id: result.id || displayComment._id, 
						isPending: false,
						updatedAt: new Date(),
						createdAt: comment.createdAt || new Date(),
					} 
					: comment
			);

			console.log("Comment saved successfully:", result);
		} catch (error) {
			console.error("Error saving comment:", error);
			alert("Failed to save comment. Please try again.");
		}
	}

	// Handles deleting a comment. Should only be called on a persisted comment, but just returns if it is.
	async function handleDeleteComment(displayComment: DisplayComment) {
		// Unwrap the highlighted text associated with this comment
		if (displayComment.wrapperObject) {
			displayComment.wrapperObject.unwrap();
		}
		
		// Remove the comment from the displayComments array
		displayComments = displayComments.filter(comment => comment !== displayComment);

		// Check if the comment is persisted (has a non-empty _id), and if so delete it from the DB
		if ('_id' in displayComment && displayComment._id) {
			try {
				const response = await fetch(`/conversation/${$page.params.id}/comments/${displayComment._id}`, {
					method: 'DELETE',
				});

				if (!response.ok) {
					throw new Error('Failed to delete comment');
				}

				console.log("Comment deleted successfully from the database");
			} catch (error) {
				console.error("Error deleting comment:", error);
				alert("Failed to delete comment. Please try again.");
				// Optionally, you could add the comment back to the displayComments array here
			}
		}
	}

	// Handles editing an existing DisplayComment. 
	function handleEditComment(displayComment: DisplayComment) {
		// Sets isPending to true
		// Sets originalContent to the content
		displayComments = displayComments.map(dc => {
			if (dc === displayComment) {
				return {
					...dc,
					isPending: true,
					originalContent: dc.content
				};
			}
			return dc;
		});

		// No database update needed. That will happen when the comment is posted (handlePostComment)
	}

	function handleCancelEditComment(displayComment: DisplayComment) {
		if (!('_id' in displayComment) || !displayComment._id) {
			// If the DisplayComment was never persisted, delete it
			handleDeleteComment(displayComment);
		} else {
			// Revert the pending edit
			displayComments = displayComments.map(dc => {
				if (dc === displayComment) {
					return {
						...dc,
						isPending: false,
						content: dc.originalContent || ""
					};
				}
				return dc;
			});
		}
		// No database updates needed
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
		<div
			class="mx-auto flex h-full max-w-3xl flex-col gap-6 px-5 pt-6 sm:gap-8 xl:max-w-4xl xl:pt-10"
		>
			{#if $page.data?.assistant && !!messages.length}
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
				<div class="flex h-max flex-col gap-6 pb-52 2xl:gap-7">
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
				<ChatIntroduction
					{models}
					{currentModel}
					on:message={(ev) => {
						if ($page.data.loginRequired) {
							ev.preventDefault();
							loginModalOpen = true;
						} else {
							dispatch("message", ev.detail);
						}
					}}
				/>
			{:else}
				<AssistantIntroduction
					{models}
					{assistant}
					on:message={(ev) => {
						if ($page.data.loginRequired) {
							ev.preventDefault();
							loginModalOpen = true;
						} else {
							dispatch("message", ev.detail);
						}
					}}
				/>
			{/if}
		</div>
		<ScrollToBottomBtn
			class="bottom-36 left-4 max-md:hidden lg:left-10"
			scrollNode={chatContainer}
		/>
	</div>
	<div
		class="dark:via-gray-80 pointer-events-none absolute inset-x-0 bottom-0 z-0 mx-auto flex w-full max-w-3xl flex-col items-center justify-center bg-gradient-to-t from-white via-white/80 to-white/0 px-3.5 py-4 max-md:border-t max-md:bg-white sm:px-5 md:py-8 xl:max-w-4xl dark:border-gray-800 dark:from-gray-900 dark:to-gray-900/0 max-md:dark:bg-gray-900 [&>*]:pointer-events-auto"
	>
		{#if sources?.length}
			<div class="flex flex-row flex-wrap justify-center gap-2.5 max-md:pb-3">
				{#each sources as source, index}
					{#await source then src}
						<UploadedFile
							file={src}
							on:close={() => {
								files = files.filter((_, i) => i !== index);
							}}
						/>
					{/await}
				{/each}
			</div>
		{/if}

		<div class="w-full">
			<div class="flex w-full pb-3">
				{#if !assistant}
					{#if currentModel.tools}
						<ToolsMenu {loading} />
					{:else if $page.data.settings?.searchEnabled}
						<WebSearchToggle />
					{/if}
				{/if}
				{#if loading}
					<StopGeneratingBtn classNames="ml-auto" on:click={() => dispatch("stop")} />
				{:else if lastIsError}
					<RetryBtn
						classNames="ml-auto"
						on:click={() => {
							if (lastMessage && lastMessage.ancestors) {
								dispatch("retry", {
									id: lastMessage.id,
								});
							}
						}}
					/>
				{:else}
					<div class="ml-auto gap-2">
						{#if isFileUploadEnabled}
							<UploadBtn bind:files mimeTypes={activeMimeTypes} classNames="ml-auto" />
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
				aria-label={isFileUploadEnabled ? "file dropzone" : undefined}
				on:submit|preventDefault={handleSubmit}
				class="relative flex w-full max-w-4xl flex-1 items-center rounded-xl border bg-gray-100 focus-within:border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:focus-within:border-gray-500
			{isReadOnly ? 'opacity-30' : ''}"
			>
				{#if onDrag && isFileUploadEnabled}
					<FileDropzone bind:files bind:onDrag mimeTypes={activeMimeTypes} />
				{:else}
					<div class="flex w-full flex-1 border-none bg-transparent">
						{#if lastIsError}
							<ChatInput value="Sorry, something went wrong. Please try again." disabled={true} />
						{:else}
							<ChatInput
								placeholder={isReadOnly
									? "This conversation is read-only. Start a new one to continue!"
									: "Ask anything"}
								bind:value={message}
								on:submit={handleSubmit}
								on:beforeinput={(ev) => {
									if ($page.data.loginRequired) {
										ev.preventDefault();
										loginModalOpen = true;
									}
								}}
								on:paste={onPaste}
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
						{#if models.find((m) => m.id === currentModel.id)}
							<a
								href="{base}/settings/{currentModel.id}"
								class="inline-flex items-center hover:underline"
								>{currentModel.displayName}<CarbonCaretDown class="text-xxs" /></a
							>
						{:else}
							<span class="inline-flex items-center line-through dark:border-gray-700">
								{currentModel.id}
							</span>
						{/if}
					{:else}
						{@const model = models.find((m) => m.id === assistant?.modelId)}
						{#if model}
							<a
								href="{base}/settings/assistants/{assistant._id}"
								class="inline-flex items-center border-b hover:text-gray-600 dark:border-gray-700 dark:hover:text-gray-300"
								>{model?.displayName}<CarbonCaretDown class="text-xxs" /></a
							>
						{:else}
							<span class="inline-flex items-center line-through dark:border-gray-700">
								{currentModel.id}
							</span>
						{/if}
					{/if}
					<span class="max-sm:hidden">·</span><br class="sm:hidden" /> Generated content may be inaccurate
					or false.
				</p>
				<p>Shared: {shared}</p>

			</div>
		</div>
	</div>
</div>
<div class="col-start-3 col-end-4 flex flex-col justify-start items-center pt-[33.33%] h-full">
	{#if messages.length && !shared}
	<button
		class="flex items-center justify-center p-2 rounded-lg bg-white shadow-md hover:shadow-lg transition-shadow duration-300 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-blue-300"
		type="button"
		on:click={onShare}
	>
		<img src="/chatui/lifesaver-500x500.png" alt="Ask for Help" class="w-20 h-20" />
		<span class="ml-4 mr-4 text-xl font-semibold text-gray-800">Share & Get Help</span>
	</button>
	<p class="mt-4 text-sm text-gray-600 text-center max-w-xs">
		Click to comment on this chat and get help from the community.
	</p>
	{:else if messages.length}
	<!--Display the list of Comments, showing their _id, content, and starting position-->
	<!-- Add this section to display the list of comments -->
	<div class="mt-4 w-full max-w-md">
		<h3 class="text-lg font-semibold mb-2">Comments</h3>
		{#if displayComments.length > 0}
			<ul class="space-y-2">
			{#each displayComments as dc, index}
				<li class="bg-gray-100 p-3 rounded-lg">
					{#if !dc.isPending}
						<p class="text-sm text-gray-600">
							{#if dc.username}
								<span class="font-semibold">{dc.username}</span><br/>
							{/if}
							{#if 'updatedAt' in dc && dc.updatedAt}
							Last Updated: {new Date(dc.updatedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
							<br/><br/>
							{/if}
						</p>
						<p>{"> " + dc.textQuoteSelector?.exact}</p>
						<p>{dc.content}</p>
						<div class="flex justify-end mt-2">
							<button
							class="mr-2 p-1 bg-green-500 text-white rounded-full"
							on:click={() => handleEditComment(dc)}
							aria-label="Edit Comment"
							>
								<CarbonEdit />
							</button>
							<button
								class="p-1 bg-red-500 text-white rounded-full"
								on:click={() => {
									if (confirm('Are you sure you want to delete this comment?')) {
										handleDeleteComment(dc);
									}
								}}
								aria-label="Delete Comment"
							>
								<CarbonTrashCan />
							</button>
						</div>
					{:else}
						<p>{"> " + dc.textQuoteSelector?.exact}</p>
						<textarea
							bind:value={dc.content}
							class="w-full p-2 border rounded-md"
							rows="3"
						></textarea>
						<div class="flex justify-end mt-2">
							<button
								class="mr-2 p-1 bg-green-500 text-white rounded-full"
								on:click={() => handlePostComment(dc)}
								aria-label="Save Comment"
							>
								<CarbonSend />
							</button>
							<button
								class="p-1 bg-red-500 text-white rounded-full"
								on:click={() => handleCancelEditComment(dc)}
								aria-label="Cancel"
							>
								<CarbonClose />
							</button>
						</div>
					{/if}

				</li>
			{/each}
			</ul>
		{:else}
			<p class="text-gray-600">No comments yet.</p>
		{/if}
	</div>
	<button
	class="mt-4 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-300"
	on:click={addComment}
	>
		Comment
	</button>
	{/if}
</div>