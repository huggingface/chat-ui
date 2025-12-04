<script lang="ts">
	import type { Message, MessageFile } from "$lib/types/Message";
	import { onDestroy } from "svelte";

	import IconOmni from "$lib/components/icons/IconOmni.svelte";
	import CarbonCaretDown from "~icons/carbon/caret-down";
	import CarbonDirectionRight from "~icons/carbon/direction-right-01";
	import IconArrowUp from "~icons/lucide/arrow-up";
	import IconMic from "~icons/lucide/mic";

	import ChatInput from "./ChatInput.svelte";
	import VoiceRecorder from "./VoiceRecorder.svelte";
	import StopGeneratingBtn from "../StopGeneratingBtn.svelte";
	import type { Model } from "$lib/types/Model";
	import FileDropzone from "./FileDropzone.svelte";
	import RetryBtn from "../RetryBtn.svelte";
	import file2base64 from "$lib/utils/file2base64";
	import { base } from "$app/paths";
	import ChatMessage from "./ChatMessage.svelte";
	import ScrollToBottomBtn from "../ScrollToBottomBtn.svelte";
	import ScrollToPreviousBtn from "../ScrollToPreviousBtn.svelte";
	import { browser } from "$app/environment";
	import { snapScrollToBottom } from "$lib/actions/snapScrollToBottom";
	import SystemPromptModal from "../SystemPromptModal.svelte";
	import ShareConversationModal from "../ShareConversationModal.svelte";
	import ChatIntroduction from "./ChatIntroduction.svelte";
	import UploadedFile from "./UploadedFile.svelte";
	import { useSettingsStore } from "$lib/stores/settings";
	import { error } from "$lib/stores/errors";
	import ModelSwitch from "./ModelSwitch.svelte";
	import { routerExamples } from "$lib/constants/routerExamples";
	import { mcpExamples } from "$lib/constants/mcpExamples";
	import type { RouterFollowUp, RouterExample } from "$lib/constants/routerExamples";
	import { allBaseServersEnabled, mcpServersLoaded } from "$lib/stores/mcpServers";
	import { shareModal } from "$lib/stores/shareModal";
	import LucideHammer from "~icons/lucide/hammer";

	import { fly } from "svelte/transition";
	import { cubicInOut } from "svelte/easing";

	import { isVirtualKeyboard } from "$lib/utils/isVirtualKeyboard";
	import { requireAuthUser } from "$lib/utils/auth";
	import { page } from "$app/state";
	import {
		isMessageToolCallUpdate,
		isMessageToolErrorUpdate,
		isMessageToolResultUpdate,
	} from "$lib/utils/messageUpdates";
	import type { ToolFront } from "$lib/types/Tool";

	interface Props {
		messages?: Message[];
		messagesAlternatives?: Message["id"][][];
		loading?: boolean;
		pending?: boolean;
		shared?: boolean;
		currentModel: Model;
		models: Model[];
		preprompt?: string | undefined;
		files?: File[];
		onmessage?: (content: string) => void;
		onstop?: () => void;
		onretry?: (payload: { id: Message["id"]; content?: string }) => void;
		onshowAlternateMsg?: (payload: { id: Message["id"] }) => void;
		draft?: string;
	}

	let {
		messages = [],
		messagesAlternatives = [],
		loading = false,
		pending = false,
		shared = false,
		currentModel,
		models,
		preprompt = undefined,
		files = $bindable([]),
		draft = $bindable(""),
		onmessage,
		onstop,
		onretry,
		onshowAlternateMsg,
	}: Props = $props();

	let isReadOnly = $derived(!models.some((model) => model.id === currentModel.id));

	let shareModalOpen = $state(false);
	let editMsdgId: Message["id"] | null = $state(null);
	let pastedLongContent = $state(false);

	// Voice recording state
	let isRecording = $state(false);
	let isTranscribing = $state(false);
	let transcriptionEnabled = $derived(
		!!(page.data as { transcriptionEnabled?: boolean }).transcriptionEnabled
	);
	let isTouchDevice = $derived(browser && navigator.maxTouchPoints > 0);

	const handleSubmit = () => {
		if (requireAuthUser() || loading || !draft) return;
		onmessage?.(draft);
		draft = "";
	};

	let lastTarget: EventTarget | null = null;

	let onDrag = $state(false);

	const onDragEnter = (e: DragEvent) => {
		lastTarget = e.target;
		onDrag = true;
	};
	const onDragLeave = (e: DragEvent) => {
		if (e.target === lastTarget) {
			onDrag = false;
		}
	};

	const onPaste = (e: ClipboardEvent) => {
		const textContent = e.clipboardData?.getData("text");

		if (!$settings.directPaste && textContent && textContent.length >= 3984) {
			e.preventDefault();
			pastedLongContent = true;
			setTimeout(() => {
				pastedLongContent = false;
			}, 1000);
			const pastedFile = new File([textContent], "Pasted Content", {
				type: "application/vnd.chatui.clipboard",
			});

			files = [...files, pastedFile];
		}

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
					return (
						(type === "*" || fileType === type) && (subtype === "*" || fileSubtype === subtype)
					);
				});
			});

			files = [...files, ...filteredFiles];
		}
	};

	let lastMessage = $derived(browser && (messages.at(-1) as Message));
	// Scroll signal includes tool updates and thinking blocks to trigger scroll on all content changes
	let scrollSignal = $derived.by(() => {
		const last = messages.at(-1) as Message | undefined;
		if (!last) return `${messages.length}:0`;

		// Count tool updates to trigger scroll when new tools are called or complete
		const toolUpdateCount = last.updates?.length ?? 0;

		// Include content length, tool count, and message count in signal
		return `${last.id}:${last.content.length}:${messages.length}:${toolUpdateCount}`;
	});
	let streamingAssistantMessage = $derived(
		(() => {
			for (let i = messages.length - 1; i >= 0; i -= 1) {
				const candidate = messages[i];
				if (candidate.from === "assistant") {
					return candidate;
				}
			}
			return undefined;
		})()
	);
	let streamingRouterMetadata = $derived(streamingAssistantMessage?.routerMetadata ?? null);
	let streamingRouterModelName = $derived(
		streamingRouterMetadata?.model
			? (streamingRouterMetadata.model.split("/").pop() ?? streamingRouterMetadata.model)
			: ""
	);

	let lastIsError = $derived(
		!loading &&
			(streamingAssistantMessage?.updates?.findIndex(
				(u) => u.type === "status" && u.status === "error"
			) ?? -1) !== -1
	);

	// Expose currently running tool call name (if any) from the streaming assistant message
	const availableTools: ToolFront[] = $derived.by(
		() => (page.data as { tools?: ToolFront[] } | undefined)?.tools ?? []
	);
	let streamingToolCallName = $derived.by(() => {
		const updates = streamingAssistantMessage?.updates ?? [];
		if (!updates.length) return null;
		const done = new Set<string>();
		for (const u of updates) {
			if (isMessageToolResultUpdate(u) || isMessageToolErrorUpdate(u)) done.add(u.uuid);
		}
		for (let i = updates.length - 1; i >= 0; i -= 1) {
			const u = updates[i];
			if (isMessageToolCallUpdate(u) && !done.has(u.uuid)) {
				return u.call.name;
			}
		}
		return null;
	});
	let showRouterDetails = $state(false);
	let routerDetailsTimeout: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		if (!currentModel.isRouter || !loading) {
			showRouterDetails = false;
			if (routerDetailsTimeout) {
				clearTimeout(routerDetailsTimeout);
				routerDetailsTimeout = undefined;
			}
			return;
		}

		if (routerDetailsTimeout) {
			clearTimeout(routerDetailsTimeout);
		}

		showRouterDetails = false;
		routerDetailsTimeout = setTimeout(() => {
			showRouterDetails = true;
		}, 500);
	});

	let sources = $derived(
		files?.map<Promise<MessageFile>>((file) =>
			file2base64(file).then((value) => ({
				type: "base64",
				value,
				mime: file.type,
				name: file.name,
			}))
		)
	);

	const unsubscribeShareModal = shareModal.subscribe((value) => {
		shareModalOpen = value;
	});

	onDestroy(() => {
		unsubscribeShareModal();
		shareModal.close();
		if (routerDetailsTimeout) {
			clearTimeout(routerDetailsTimeout);
		}
	});

	let chatContainer: HTMLElement | undefined = $state();

	// Force scroll to bottom when user sends a new message
	// Pattern: user message + empty assistant message are added together
	let prevMessageCount = $state(messages.length);
	let forceReattach = $state(0);
	$effect(() => {
		if (messages.length > prevMessageCount) {
			const last = messages.at(-1);
			const secondLast = messages.at(-2);
			const userJustSentMessage =
				messages.length === prevMessageCount + 2 &&
				secondLast?.from === "user" &&
				last?.from === "assistant" &&
				last?.content === "";

			if (userJustSentMessage) {
				forceReattach++;
			}
		}
		prevMessageCount = messages.length;
	});

	// Combined scroll dependency for the action
	let scrollDependency = $derived({ signal: scrollSignal, forceReattach });

	const settings = useSettingsStore();
	let hideRouterExamples = $derived($settings.hidePromptExamples?.[currentModel.id] ?? false);

	// Respect per‑model multimodal toggle from settings (force enable)
	let modelIsMultimodalOverride = $derived($settings.multimodalOverrides?.[currentModel.id]);
	let modelIsMultimodal = $derived((modelIsMultimodalOverride ?? currentModel.multimodal) === true);

	// Determine tool support for the current model (server-provided capability with user override)
	let modelSupportsTools = $derived(
		($settings.toolsOverrides?.[currentModel.id] ??
			(currentModel as unknown as { supportsTools?: boolean }).supportsTools) === true
	);

	// Always allow common text-like files; add images only when model is multimodal
	import { TEXT_MIME_ALLOWLIST, IMAGE_MIME_ALLOWLIST_DEFAULT } from "$lib/constants/mime";

	let activeMimeTypes = $derived(
		Array.from(
			new Set([
				...TEXT_MIME_ALLOWLIST,
				...(modelIsMultimodal
					? (currentModel.multimodalAcceptedMimetypes ?? [...IMAGE_MIME_ALLOWLIST_DEFAULT])
					: []),
			])
		)
	);
	let isFileUploadEnabled = $derived(activeMimeTypes.length > 0);
	let focused = $state(false);

	let activeRouterExamplePrompt = $state<string | null>(null);
	// Use MCP examples when all base servers are enabled, otherwise use router examples
	let activeExamples = $derived<RouterExample[]>(
		$allBaseServersEnabled ? mcpExamples : routerExamples
	);
	let routerFollowUps = $derived<RouterFollowUp[]>(
		activeRouterExamplePrompt
			? (activeExamples.find((ex) => ex.prompt === activeRouterExamplePrompt)?.followUps ?? [])
			: []
	);
	let routerUserMessages = $derived(messages.filter((msg) => msg.from === "user"));
	let shouldShowRouterFollowUps = $derived(
		!draft.length &&
			activeRouterExamplePrompt &&
			routerFollowUps.length > 0 &&
			routerUserMessages.length === 1 &&
			currentModel.isRouter &&
			!hideRouterExamples &&
			!loading
	);

	$effect(() => {
		if (!currentModel.isRouter || !messages.length) {
			activeRouterExamplePrompt = null;
			return;
		}

		const firstUserMessage = messages.find((msg) => msg.from === "user");
		if (!firstUserMessage) {
			activeRouterExamplePrompt = null;
			return;
		}

		const match = activeExamples.find((ex) => ex.prompt.trim() === firstUserMessage.content.trim());
		activeRouterExamplePrompt = match ? match.prompt : null;
	});

	function triggerPrompt(prompt: string) {
		if (requireAuthUser() || loading) return;
		draft = prompt;
		handleSubmit();
	}

	async function startExample(example: RouterExample) {
		if (requireAuthUser()) return;
		activeRouterExamplePrompt = example.prompt;

		if (browser && example.attachments?.length) {
			const loadedFiles: File[] = [];
			for (const attachment of example.attachments) {
				try {
					const response = await fetch(`${base}/${attachment.src}`);
					if (!response.ok) continue;

					const blob = await response.blob();
					const name = attachment.src.split("/").pop() ?? "attachment";
					loadedFiles.push(
						new File([blob], name, { type: blob.type || "application/octet-stream" })
					);
				} catch (err) {
					console.error("Error loading attachment:", err);
				}
			}
			files = loadedFiles;
		}

		triggerPrompt(example.prompt);
	}

	function startFollowUp(followUp: RouterFollowUp) {
		triggerPrompt(followUp.prompt);
	}

	async function handleRecordingConfirm(audioBlob: Blob) {
		isRecording = false;
		isTranscribing = true;

		try {
			const response = await fetch(`${base}/api/transcribe`, {
				method: "POST",
				headers: { "Content-Type": audioBlob.type },
				body: audioBlob,
			});

			if (!response.ok) {
				throw new Error(await response.text());
			}

			const { text } = await response.json();
			const trimmedText = text?.trim();
			if (trimmedText) {
				// Append transcribed text to draft
				draft = draft.trim() ? `${draft.trim()} ${trimmedText}` : trimmedText;
			}
		} catch (err) {
			console.error("Transcription error:", err);
			$error = "Transcription failed. Please try again.";
		} finally {
			isTranscribing = false;
		}
	}

	async function handleRecordingSend(audioBlob: Blob) {
		isRecording = false;
		isTranscribing = true;

		try {
			const response = await fetch(`${base}/api/transcribe`, {
				method: "POST",
				headers: { "Content-Type": audioBlob.type },
				body: audioBlob,
			});

			if (!response.ok) {
				throw new Error(await response.text());
			}

			const { text } = await response.json();
			const trimmedText = text?.trim();
			if (trimmedText) {
				// Set draft and send immediately
				draft = draft.trim() ? `${draft.trim()} ${trimmedText}` : trimmedText;
				handleSubmit();
			}
		} catch (err) {
			console.error("Transcription error:", err);
			$error = "Transcription failed. Please try again.";
		} finally {
			isTranscribing = false;
		}
	}

	function handleRecordingError(message: string) {
		console.error("Recording error:", message);
		isRecording = false;
		$error = message;
	}
</script>

<svelte:window
	ondragenter={onDragEnter}
	ondragleave={onDragLeave}
	ondragover={(e) => {
		e.preventDefault();
	}}
	ondrop={(e) => {
		e.preventDefault();
		onDrag = false;
	}}
/>

<div class="relative z-[-1] min-h-0 min-w-0">
	{#if shareModalOpen}
		<ShareConversationModal open={shareModalOpen} onclose={() => shareModal.close()} />
	{/if}
	<div
		class="scrollbar-custom h-full overflow-y-auto"
		use:snapScrollToBottom={scrollDependency}
		bind:this={chatContainer}
	>
		<div
			class="mx-auto flex h-full max-w-3xl flex-col gap-6 px-5 pt-6 sm:gap-8 xl:max-w-4xl xl:pt-10"
		>
			{#if preprompt && preprompt != currentModel.preprompt}
				<SystemPromptModal preprompt={preprompt ?? ""} />
			{/if}

			{#if messages.length > 0}
				<div class="flex h-max flex-col gap-8 pb-52">
					{#each messages as message, idx (message.id)}
						<ChatMessage
							{loading}
							{message}
							alternatives={messagesAlternatives.find((a) => a.includes(message.id)) ?? []}
							isAuthor={!shared}
							readOnly={isReadOnly}
							isLast={idx === messages.length - 1}
							bind:editMsdgId
							onretry={(payload) => onretry?.(payload)}
							onshowAlternateMsg={(payload) => onshowAlternateMsg?.(payload)}
						/>
					{/each}
					{#if isReadOnly}
						<ModelSwitch {models} {currentModel} />
					{/if}
				</div>
			{:else if pending}
				<ChatMessage
					loading={true}
					message={{
						id: "0-0-0-0-0",
						content: "",
						from: "assistant",
						children: [],
					}}
					isAuthor={!shared}
					readOnly={isReadOnly}
				/>
			{:else}
				<ChatIntroduction
					{currentModel}
					onmessage={(content) => {
						onmessage?.(content);
					}}
				/>
			{/if}
		</div>

		<ScrollToPreviousBtn class="fixed bottom-48 right-4 lg:right-10" scrollNode={chatContainer} />

		<ScrollToBottomBtn class="fixed bottom-36 right-4 lg:right-10" scrollNode={chatContainer} />
	</div>

	<div
		class="pointer-events-none absolute inset-x-0 bottom-0 z-0 mx-auto flex w-full
			max-w-3xl flex-col items-center justify-center bg-gradient-to-t from-white
			via-white/100 to-white/0 px-3.5 pt-2 dark:border-gray-800
			dark:from-gray-900 dark:via-gray-900/100
			dark:to-gray-900/0 max-sm:py-0 sm:px-5 md:pb-4 xl:max-w-4xl [&>*]:pointer-events-auto"
	>
		{#if !draft.length && !messages.length && !sources.length && !loading && currentModel.isRouter && activeExamples.length && !hideRouterExamples && !lastIsError && $mcpServersLoaded}
			<div
				class="no-scrollbar mb-3 flex w-full select-none justify-start gap-2 overflow-x-auto whitespace-nowrap text-gray-400 dark:text-gray-500"
			>
				{#each activeExamples as ex}
					<button
						class="flex items-center rounded-lg bg-gray-100/90 px-2 py-0.5 text-center text-sm backdrop-blur hover:text-gray-500 dark:bg-gray-700/50 dark:hover:text-gray-400"
						onclick={() => startExample(ex)}>{ex.title}</button
					>
				{/each}
			</div>
		{/if}
		{#if shouldShowRouterFollowUps && !lastIsError}
			<div
				class="no-scrollbar mb-3 flex w-full select-none justify-start gap-2 overflow-x-auto whitespace-nowrap text-gray-400 dark:text-gray-500"
			>
				<!-- <span class=" text-gray-500 dark:text-gray-400">Follow ups</span> -->
				{#each routerFollowUps as followUp}
					<button
						class="flex items-center gap-1 rounded-lg bg-gray-100/90 px-2 py-0.5 text-center text-sm backdrop-blur hover:text-gray-500 dark:bg-gray-700/50 dark:hover:text-gray-400"
						onclick={() => startFollowUp(followUp)}
					>
						<CarbonDirectionRight class="scale-y-[-1] text-xs" />
						{followUp.title}</button
					>
				{/each}
			</div>
		{/if}
		{#if sources?.length && !loading}
			<div
				in:fly|local={sources.length === 1 ? { y: -20, easing: cubicInOut } : undefined}
				class="flex flex-row flex-wrap justify-center gap-2.5 rounded-xl pb-3"
			>
				{#each sources as source, index}
					{#await source then src}
						<UploadedFile
							file={src}
							onclose={() => {
								files = files.filter((_, i) => i !== index);
							}}
						/>
					{/await}
				{/each}
			</div>
		{/if}

		<div class="w-full">
			<div class="flex w-full *:mb-3">
				{#if !loading && lastIsError}
					<RetryBtn
						classNames="ml-auto"
						onClick={() => {
							if (lastMessage && lastMessage.ancestors) {
								onretry?.({
									id: lastMessage.id,
								});
							}
						}}
					/>
				{/if}
			</div>
			<form
				tabindex="-1"
				aria-label={isFileUploadEnabled ? "file dropzone" : undefined}
				onsubmit={(e) => {
					e.preventDefault();
					handleSubmit();
				}}
				class={{
					"relative flex w-full max-w-4xl flex-1 items-center rounded-xl border bg-gray-100 dark:border-gray-700 dark:bg-gray-800": true,
					"opacity-30": isReadOnly,
					"max-sm:mb-4": focused && isVirtualKeyboard(),
				}}
			>
				{#if isRecording || isTranscribing}
					<VoiceRecorder
						{isTranscribing}
						{isTouchDevice}
						oncancel={() => {
							isRecording = false;
						}}
						onconfirm={handleRecordingConfirm}
						onsend={handleRecordingSend}
						onerror={handleRecordingError}
					/>
				{:else if onDrag && isFileUploadEnabled}
					<FileDropzone bind:files bind:onDrag mimeTypes={activeMimeTypes} />
				{:else}
					<div
						class="flex w-full flex-1 rounded-xl border-none bg-transparent"
						class:paste-glow={pastedLongContent}
					>
						{#if lastIsError}
							<ChatInput value="Sorry, something went wrong. Please try again." disabled={true} />
						{:else}
							<ChatInput
								placeholder={isReadOnly ? "This conversation is read-only." : "Ask anything"}
								{loading}
								bind:value={draft}
								bind:files
								mimeTypes={activeMimeTypes}
								onsubmit={handleSubmit}
								{onPaste}
								disabled={isReadOnly || lastIsError}
								{modelIsMultimodal}
								{modelSupportsTools}
								bind:focused
							/>
						{/if}

						{#if loading}
							<StopGeneratingBtn
								onClick={() => onstop?.()}
								showBorder={true}
								classNames="absolute bottom-2 right-2 size-8 sm:size-7 self-end rounded-full border bg-white text-black shadow transition-none dark:border-transparent dark:bg-gray-600 dark:text-white"
							/>
						{:else}
							{#if transcriptionEnabled}
								<button
									type="button"
									class="btn absolute bottom-2 right-10 mr-1.5 size-8 self-end rounded-full border bg-white/50 text-gray-500 transition-none hover:bg-gray-50 hover:text-gray-700 dark:border-transparent dark:bg-gray-600/50 dark:text-gray-300 dark:hover:bg-gray-500 dark:hover:text-white sm:right-9 sm:size-7"
									disabled={isReadOnly}
									onclick={() => {
										isRecording = true;
									}}
									aria-label="Start voice recording"
								>
									<IconMic class="size-4" />
								</button>
							{/if}
							<button
								class="btn absolute bottom-2 right-2 size-8 self-end rounded-full border bg-white text-black shadow transition-none enabled:hover:bg-white enabled:hover:shadow-inner dark:border-transparent dark:bg-gray-600 dark:text-white dark:hover:enabled:bg-black sm:size-7 {!draft ||
								isReadOnly
									? ''
									: '!bg-black !text-white dark:!bg-white dark:!text-black'}"
								disabled={!draft || isReadOnly}
								type="submit"
								aria-label="Send message"
								name="submit"
							>
								<IconArrowUp />
							</button>
						{/if}
					</div>
				{/if}
			</form>
			<div
				class={{
					"mt-1.5 flex h-5 items-center self-stretch whitespace-nowrap px-0.5 text-xs text-gray-400/90 max-md:mb-2 max-sm:gap-2": true,
					"max-sm:hidden": focused && isVirtualKeyboard(),
				}}
			>
				{#if models.find((m) => m.id === currentModel.id)}
					{#if loading && streamingToolCallName}
						<span class="inline-flex items-center gap-1 whitespace-nowrap text-xs">
							<LucideHammer class="size-3" />
							Calling tool
							<span class="loading-dots font-medium">
								{availableTools.find((t) => t.name === streamingToolCallName)?.displayName ??
									streamingToolCallName}
							</span>
						</span>
					{:else if !currentModel.isRouter || !loading}
						<a
							href="{base}/settings/{currentModel.id}"
							onclick={(e) => {
								if (requireAuthUser()) {
									e.preventDefault();
								}
							}}
							class="inline-flex items-center gap-1 hover:underline"
						>
							{#if currentModel.isRouter}
								<IconOmni />
								{currentModel.displayName}
							{:else}
								Model: {currentModel.displayName}
							{/if}
							<CarbonCaretDown class="-ml-0.5 text-xxs" />
						</a>
					{:else if showRouterDetails && streamingRouterMetadata?.route}
						<div
							class="mr-2 flex items-center gap-1.5 whitespace-nowrap text-[.70rem] text-xs leading-none text-gray-400 dark:text-gray-400"
						>
							<IconOmni classNames="text-xs animate-pulse" />

							<span class="router-badge-text router-shimmer">
								{streamingRouterMetadata.route}
							</span>

							<span class="text-gray-500">with</span>

							<span class="router-badge-text">
								{streamingRouterModelName}
							</span>
						</div>
					{:else}
						<div
							class="loading-dots relative inline-flex items-center text-gray-400 dark:text-gray-400"
							aria-label="Routing…"
						>
							<IconOmni classNames="text-xs animate-pulse mr-1" /> Routing
						</div>
					{/if}
				{:else}
					<span class="inline-flex items-center line-through dark:border-gray-700">
						{currentModel.id}
					</span>
				{/if}
				{#if !messages.length && !loading}
					<span>Generated content may be inaccurate or false.</span>
				{/if}
			</div>
		</div>
	</div>
</div>

<style lang="postcss">
	.paste-glow {
		animation: glow 1s cubic-bezier(0.4, 0, 0.2, 1) forwards;
		will-change: box-shadow;
	}

	@keyframes glow {
		0% {
			box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.8);
		}
		50% {
			box-shadow: 0 0 20px 4px rgba(59, 130, 246, 0.6);
		}
		100% {
			box-shadow: 0 0 0 0 rgba(59, 130, 246, 0);
		}
	}

	.router-badge-text {
		display: inline-block;
		position: relative;
		color: inherit;
	}

	.router-shimmer {
		display: inline-block;
		background-image: linear-gradient(
			90deg,
			rgba(156, 163, 175, 1) 0%,
			rgba(156, 163, 175, 0.6) 10%,
			rgba(156, 163, 175, 0.6) 50%,
			rgba(156, 163, 175, 0.6) 90%,
			rgba(156, 163, 175, 1) 100%
		);
		background-size: 220% 100%;
		animation: router-shimmer 2.8s linear infinite;
		background-clip: text;
		-webkit-background-clip: text;
		color: transparent;
		-webkit-text-fill-color: transparent;
	}

	:global(.dark) .router-shimmer {
		background-image: linear-gradient(
			90deg,
			rgba(255, 255, 255, 0.15) 0%,
			rgba(255, 255, 255, 0.7) 50%,
			rgba(255, 255, 255, 0.15) 100%
		);
	}

	@keyframes router-shimmer {
		0% {
			background-position: 200% 0;
		}
		100% {
			background-position: -200% 0;
		}
	}

	.loading-dots::after {
		content: "";
		animation: dots-content 0.9s steps(1, end) infinite;
	}
	@keyframes dots-content {
		0% {
			content: "";
		}
		33% {
			content: ".";
		}
		66% {
			content: "..";
		}
		88% {
			content: "...";
		}
	}
</style>
