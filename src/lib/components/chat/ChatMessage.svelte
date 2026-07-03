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
	import CarbonCopy from "~icons/carbon/copy";
	import CarbonCheckmark from "~icons/carbon/checkmark";
	import UploadedFile from "./UploadedFile.svelte";

	import MarkdownRenderer from "./MarkdownRenderer.svelte";
	import OpenReasoningResults from "./OpenReasoningResults.svelte";
	import Alternatives from "./Alternatives.svelte";
	import MessageAvatar from "./MessageAvatar.svelte";
	import { PROVIDERS_HUB_ORGS } from "@huggingface/inference";
	import { requireAuthUser } from "$lib/utils/auth";
	import ToolUpdate from "./ToolUpdate.svelte";
	import ToolCallsSummary from "./ToolCallsSummary.svelte";
	import ArtifactCard from "./ArtifactCard.svelte";
	import { isMessageToolUpdate } from "$lib/utils/messageUpdates";
	import { MessageUpdateType, type MessageToolUpdate } from "$lib/types/MessageUpdate";
	import ImageLightbox from "./ImageLightbox.svelte";
	import { splitArtifactSegments, stripArtifacts } from "$lib/utils/artifacts";
	import type { ArtifactOperation } from "$lib/utils/artifacts";

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
	let isUserMsgCopied = $state(false);
	let userCopyTimeout: ReturnType<typeof setTimeout>;
	let messageWidth: number = $state(0);
	let messageInfoWidth: number = $state(0);
	let lightboxSrc: string | null = $state(null);

	function handleContentClick(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (target.tagName === "IMG" && target instanceof HTMLImageElement) {
			e.preventDefault();
			e.stopPropagation();
			lightboxSrc = target.src;
		}
	}

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

	function handleCopy(event: ClipboardEvent) {
		if (!contentEl) return;

		const selection = window.getSelection();
		if (!selection || selection.isCollapsed) return;
		if (!selection.anchorNode || !selection.focusNode) return;

		const anchorInside = contentEl.contains(selection.anchorNode);
		const focusInside = contentEl.contains(selection.focusNode);
		if (!anchorInside && !focusInside) return;

		if (!event.clipboardData) return;

		const range = selection.getRangeAt(0);
		const wrapper = document.createElement("div");
		wrapper.appendChild(range.cloneContents());

		wrapper.querySelectorAll("[data-exclude-from-copy]").forEach((el) => {
			el.remove();
		});

		wrapper.querySelectorAll("*").forEach((el) => {
			el.removeAttribute("style");
			el.removeAttribute("class");
			el.removeAttribute("color");
			el.removeAttribute("bgcolor");
			el.removeAttribute("background");

			for (const attr of Array.from(el.attributes)) {
				if (attr.name === "id" || attr.name.startsWith("data-")) {
					el.removeAttribute(attr.name);
				}
			}
		});

		const html = wrapper.innerHTML;
		const text = wrapper.textContent ?? "";

		event.preventDefault();
		event.clipboardData.setData("text/html", html);
		event.clipboardData.setData("text/plain", text);
	}

	let editContentEl: HTMLTextAreaElement | undefined = $state();
	let editFormEl: HTMLFormElement | undefined = $state();

	// Zero-config reasoning autodetection: detect <think> blocks in content
	const THINK_BLOCK_REGEX = /(<think>[\s\S]*?(?:<\/think>|$))/gi;

	// Strip think blocks and artifact tags for clipboard copy (always, regardless of detection)
	let contentWithoutThink = $derived.by(() =>
		stripArtifacts(message.content.replace(THINK_BLOCK_REGEX, "")).trim()
	);

	type Block =
		| { type: "text"; content: string }
		| { type: "think"; content: string; closed: boolean }
		| { type: "tool"; uuid: string; updates: MessageToolUpdate[] }
		| { type: "artifact"; op: ArtifactOperation; opIndex: number };

	type ToolBlock = Extract<Block, { type: "tool" }>;
	type ProcessBlock = Extract<Block, { type: "think" } | { type: "tool" }>;

	type RenderUnit =
		| { kind: "text"; content: string }
		| { kind: "group"; blocks: ProcessBlock[]; toolCount: number }
		| { kind: "artifact"; op: ArtifactOperation; opIndex: number };

	// Expand any text block containing <think>…</think> into dedicated think blocks
	// so reasoning can be grouped/collapsed separately from the answer text.
	function expandThinkBlocks(input: Block[]): Block[] {
		const out: Block[] = [];
		for (const block of input) {
			if (block.type !== "text") {
				out.push(block);
				continue;
			}
			for (const part of block.content.split(THINK_BLOCK_REGEX)) {
				if (!part) continue;
				if (part.startsWith("<think>")) {
					const closed = part.endsWith("</think>");
					out.push({ type: "think", content: part.slice(7, closed ? -8 : undefined), closed });
				} else if (part.trim().length > 0) {
					out.push({ type: "text", content: part });
				}
			}
		}
		return out;
	}

	// Replace inline <artifact> blocks in text with dedicated artifact blocks that
	// render as cards (content lives in the artifact panel). Streaming-safe:
	// partially received tags are hidden until complete.
	function expandArtifactBlocks(input: Block[]): Block[] {
		const out: Block[] = [];
		let opIndex = 0;
		for (const block of input) {
			if (block.type !== "text") {
				out.push(block);
				continue;
			}
			for (const segment of splitArtifactSegments(block.content)) {
				if (segment.type === "artifact") {
					out.push({ type: "artifact", op: segment.op, opIndex: opIndex++ });
				} else if (segment.content.length > 0) {
					out.push({ type: "text", content: segment.content });
				}
			}
		}
		return collapseConsecutiveArtifactOps(out);
	}

	// Models sometimes emit several back-to-back operations on the same artifact
	// (e.g. one update block per find/replace pair). Every op still becomes a
	// version in the registry, but showing a card per op clutters the chat —
	// keep only the last card of each consecutive run.
	function collapseConsecutiveArtifactOps(input: Block[]): Block[] {
		const out: Block[] = [];
		for (const block of input) {
			if (block.type === "artifact") {
				let i = out.length - 1;
				while (i >= 0) {
					const prior = out[i];
					if (prior.type === "text" && prior.content.trim().length === 0) {
						i -= 1;
						continue;
					}
					if (prior.type === "artifact" && prior.op.identifier === block.op.identifier) {
						// Drop the earlier card (and the whitespace between) — this
						// later op supersedes it.
						out.splice(i, out.length - i);
					}
					break;
				}
			}
			out.push(block);
		}
		return out;
	}

	let blocks = $derived.by(() => {
		const updates = message.updates ?? [];
		const res: Block[] = [];
		const hasTools = updates.some(isMessageToolUpdate);
		let contentCursor = 0;
		let sawFinalAnswer = false;

		// Fast path: no tool updates at all
		if (!hasTools && updates.length === 0) {
			return expandArtifactBlocks(
				expandThinkBlocks(
					message.content ? [{ type: "text" as const, content: message.content }] : []
				)
			);
		}

		for (const update of updates) {
			if (update.type === MessageUpdateType.Stream) {
				const token =
					typeof update.token === "string" && update.token.length > 0 ? update.token : null;
				const len = token !== null ? token.length : (update.len ?? 0);
				const chunk =
					token ??
					(message.content ? message.content.slice(contentCursor, contentCursor + len) : "");
				contentCursor += len;
				if (!chunk) continue;
				const last = res.at(-1);
				if (last?.type === "text") last.content += chunk;
				else res.push({ type: "text" as const, content: chunk });
			} else if (isMessageToolUpdate(update)) {
				const existingBlock = res.find(
					(b): b is ToolBlock => b.type === "tool" && b.uuid === update.uuid
				);
				if (existingBlock) {
					existingBlock.updates.push(update);
				} else {
					res.push({ type: "tool" as const, uuid: update.uuid, updates: [update] });
				}
			} else if (update.type === MessageUpdateType.FinalAnswer) {
				sawFinalAnswer = true;
				const finalText = update.text ?? "";
				const currentText = res
					.filter((b) => b.type === "text")
					.map((b) => (b as { type: "text"; content: string }).content)
					.join("");

				let addedText = "";
				if (finalText.startsWith(currentText)) {
					addedText = finalText.slice(currentText.length);
				} else if (!currentText.endsWith(finalText)) {
					const needsGap = !/\n\n$/.test(currentText) && !/^\n/.test(finalText);
					addedText = (needsGap ? "\n\n" : "") + finalText;
				}

				if (addedText) {
					const last = res.at(-1);
					if (last?.type === "text") {
						last.content += addedText;
					} else {
						res.push({ type: "text" as const, content: addedText });
					}
				}
			}
		}

		// If content remains unmatched (e.g., persisted stream markers), append the remainder
		// Skip when a FinalAnswer already provided the authoritative text.
		if (!sawFinalAnswer && message.content && contentCursor < message.content.length) {
			const remaining = message.content.slice(contentCursor);
			if (remaining.length > 0) {
				const last = res.at(-1);
				if (last?.type === "text") last.content += remaining;
				else res.push({ type: "text" as const, content: remaining });
			}
		} else if (!res.some((b) => b.type === "text") && message.content) {
			// Fallback: no text produced at all
			res.push({ type: "text" as const, content: message.content });
		}

		return expandArtifactBlocks(expandThinkBlocks(res));
	});

	// Coalesce consecutive process blocks (thinking + tools) into groups so they can
	// collapse into a single "Called N tools" / "Thought" summary. Text passes through.
	let renderUnits = $derived.by(() => {
		const units: RenderUnit[] = [];
		let current: ProcessBlock[] | null = null;
		const flush = () => {
			if (current && current.length) {
				const toolCount = current.filter((b) => b.type === "tool").length;
				units.push({ kind: "group", blocks: current, toolCount });
			}
			current = null;
		};
		for (const block of blocks) {
			if (block.type === "think" || block.type === "tool") {
				(current ??= []).push(block);
			} else if (block.type === "artifact") {
				flush();
				units.push({ kind: "artifact", op: block.op, opIndex: block.opIndex });
			} else {
				flush();
				units.push({ kind: "text", content: block.content });
			}
		}
		flush();
		return units;
	});

	// Still mid-process (thinking / calling tools, no answer yet) → render the
	// blocks flat like today. Once the final answer starts streaming the last
	// block becomes text, so this flips to false and the nested summary takes over.
	let isProcessStreaming = $derived.by(() => {
		if (!isLast || !loading) return false;
		const last = blocks.at(-1);
		return !!last && (last.type === "think" || last.type === "tool");
	});

	// Safari has no scroll anchoring: when the process phase ends, the expanded
	// streaming think/tool blocks are torn down and replaced by their collapsed
	// nested summaries in a single flush. Content above the answer shrinks by a
	// few hundred px and the viewport visibly jumps. Compensate the scroll
	// container in the same pre-paint flush so what the reader sees stays still.
	let wasProcessStreaming = false;
	$effect(() => {
		const streaming = isProcessStreaming;
		if (wasProcessStreaming && !streaming && contentEl) {
			const el = contentEl;
			const scroller = el.closest(".overflow-y-auto");
			const before = el.getBoundingClientRect();
			if (scroller && before.top < scroller.getBoundingClientRect().bottom) {
				void tick().then(() => {
					const delta = before.height - el.getBoundingClientRect().height;
					if (delta > 0) scroller.scrollTop -= delta;
				});
			}
		}
		wasProcessStreaming = streaming;
	});

	$effect(() => {
		if (isCopied) {
			setTimeout(() => {
				isCopied = false;
			}, 1000);
		}
	});

	// Tailwind's `prose` resets font-size to 1rem while the app shell uses
	// `text-smd` (0.94rem); re-applying it here keeps answer text — and every
	// em-scaled child (code, pre, lists, tables, KaTeX) — in line with the rest
	// of the UI. Single source for both the streaming and final render branches.
	const proseClasses =
		"prose max-w-none text-smd dark:prose-invert prose-headings:font-semibold prose-h1:text-lg prose-h2:text-base prose-h3:text-base prose-pre:bg-gray-800 prose-img:my-0 prose-img:cursor-pointer prose-img:rounded-lg dark:prose-pre:bg-gray-900";

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
			class="relative flex min-w-[60px] flex-col gap-2 rounded-2xl border border-gray-100 bg-linear-to-br from-gray-50 px-5 py-3.5 wrap-break-word text-gray-600 dark:border-gray-800 dark:from-gray-800/80 dark:text-gray-300 prose-pre:my-2"
		>
			{#if message.files?.length}
				<div class="flex h-fit flex-wrap gap-x-5 gap-y-2">
					{#each message.files as file (file.value)}
						<UploadedFile {file} canClose={false} />
					{/each}
				</div>
			{/if}

			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<div bind:this={contentEl} oncopy={handleCopy} onclick={handleContentClick}>
				{#if isLast && loading && blocks.length === 0}
					<IconLoading classNames="loading inline ml-2 first:ml-0" />
				{/if}
				{#if isProcessStreaming}
					<!-- Streaming the thinking / tool phase: render every block flat and
					     inline, exactly like today. Nesting kicks in once the answer starts. -->
					{#each blocks as block, blockIndex (block.type === "tool" ? `tool-${block.uuid}-${blockIndex}` : `block-${blockIndex}`)}
						{#if block.type === "text"}
							{#if block.content.trim().length > 0}
								<div class={proseClasses}>
									<MarkdownRenderer content={block.content} loading={isLast && loading} />
								</div>
							{/if}
						{:else if block.type === "artifact"}
							<ArtifactCard op={block.op} messageId={message.id} opIndex={block.opIndex} />
						{:else}
							<div data-exclude-from-copy class="not-last:mb-1 has-[+.prose]:mb-2! [.prose+&]:mt-3">
								{#if block.type === "think"}
									<OpenReasoningResults
										content={block.content}
										loading={isLast && loading && !block.closed}
									/>
								{:else}
									<ToolUpdate tool={block.updates} {loading} />
								{/if}
							</div>
						{/if}
					{/each}
				{:else}
					<!-- Answer started or generation finished: nest the process blocks. -->
					{#each renderUnits as unit, unitIndex (`${unit.kind}-${unitIndex}`)}
						{#if unit.kind === "text"}
							{#if isLast && loading && unit.content.length === 0}
								<IconLoading classNames="loading inline ml-2 first:ml-0" />
							{:else if unit.content.trim().length > 0}
								<div class={proseClasses}>
									<MarkdownRenderer content={unit.content} loading={isLast && loading} />
								</div>
							{/if}
						{:else if unit.kind === "artifact"}
							<ArtifactCard op={unit.op} messageId={message.id} opIndex={unit.opIndex} />
						{:else if unit.kind === "group"}
							<div data-exclude-from-copy class="not-last:mb-1 has-[+.prose]:mb-2! [.prose+&]:mt-3">
								{#if unit.blocks.length > 1}
									<!-- Collapse the whole run into a single summary -->
									<ToolCallsSummary blocks={unit.blocks} toolCount={unit.toolCount} />
								{:else}
									<!-- A lone process block stays standalone -->
									{@const only = unit.blocks[0]}
									{#if only.type === "think"}
										<OpenReasoningResults content={only.content} loading={false} />
									{:else}
										<ToolUpdate tool={only.updates} loading={false} />
									{/if}
								{/if}
							</div>
						{/if}
					{/each}
				{/if}
			</div>
		</div>

		{#if message.routerMetadata || (!loading && message.content)}
			<div
				class="absolute -bottom-3.5 {message.routerMetadata && messageInfoWidth > messageWidth
					? 'left-1 pl-1 @2xl:pl-7'
					: 'right-1'} flex max-w-[100cqw] items-center gap-0.5"
				bind:offsetWidth={messageInfoWidth}
			>
				{#if message.routerMetadata && (message.routerMetadata.route || message.routerMetadata.model || message.routerMetadata.provider) && (!isLast || !loading)}
					<div
						class="mr-2 flex items-center gap-1.5 truncate text-[.65rem] whitespace-nowrap text-gray-400 @xl:text-xs dark:text-gray-400 dark:opacity-50"
					>
						{#if message.routerMetadata.route && message.routerMetadata.model}
							<span
								class="truncate rounded-sm bg-gray-100 px-1 font-mono @xl:py-px dark:bg-gray-800"
							>
								{message.routerMetadata.route}
							</span>
							<span class="text-gray-500">with</span>
							{#if publicConfig.isHuggingChat}
								<a
									href="/chat/settings/{message.routerMetadata.model}"
									class="flex items-center gap-1 truncate rounded-sm bg-gray-100 px-1 font-mono hover:text-gray-500 @xl:py-px dark:bg-gray-800 dark:hover:text-gray-300"
								>
									{message.routerMetadata.model.split("/").pop()}
								</a>
							{:else}
								<span
									class="truncate rounded-sm bg-gray-100 px-1.5 font-mono @xl:py-px dark:bg-gray-800"
								>
									{message.routerMetadata.model.split("/").pop()}
								</span>
							{/if}
						{/if}
						{#if message.routerMetadata.provider}
							{@const hubOrg = PROVIDERS_HUB_ORGS[message.routerMetadata.provider]}
							<span class="text-gray-500 @max-xl:hidden">via</span>
							<a
								target="_blank"
								href="https://huggingface.co/{hubOrg}"
								class="flex items-center gap-1 truncate rounded-sm bg-gray-100 px-1 font-mono hover:text-gray-500 @max-xl:hidden @xl:py-px dark:bg-gray-800 dark:hover:text-gray-300"
							>
								<img
									src="https://huggingface.co/api/avatars/{hubOrg}"
									alt="{message.routerMetadata.provider} logo"
									class="size-2.5 flex-none rounded-xs"
									onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
								/>
								{message.routerMetadata.provider}
							</a>
						{/if}
					</div>
				{/if}
				{#if !isLast || !loading}
					<CopyToClipBoardBtn
						onClick={() => {
							isCopied = true;
						}}
						classNames="btn rounded-xs p-1 text-sm text-gray-400 hover:text-gray-500 focus:ring-0 dark:text-gray-400 dark:hover:text-gray-300"
						value={contentWithoutThink}
						iconClassNames="text-xs"
					/>
					<button
						class="btn rounded-xs p-1 text-xs text-gray-400 hover:text-gray-500 focus:ring-0 dark:text-gray-400 dark:hover:text-gray-300"
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
	{#if lightboxSrc}
		<ImageLightbox src={lightboxSrc} onclose={() => (lightboxSrc = null)} />
	{/if}
{/if}
{#if message.from === "user"}
	<div
		class="group relative {alternatives.length > 1 && editMsdgId === null
			? 'mb-7'
			: ''} w-full items-start justify-start gap-4"
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
						class="disabled w-full appearance-none bg-inherit px-5 py-3.5 text-wrap wrap-break-word whitespace-break-spaces text-gray-500 dark:text-gray-400"
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
							class="w-full rounded-xl bg-gray-100 px-5 py-3.5 wrap-break-word whitespace-break-spaces text-gray-500 *:h-max focus:outline-hidden dark:bg-gray-800 dark:text-gray-400"
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
									? 'bg-gray-200 text-gray-400 dark:bg-gray-800 dark:text-gray-600'
									: 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-800 focus:ring-0 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-gray-200'}
								"
								disabled={loading}
							>
								Send
							</button>
							<button
								type="button"
								class="btn rounded-xs p-2 text-sm text-gray-400 hover:text-gray-500 focus:ring-0 dark:text-gray-400 dark:hover:text-gray-300"
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
			<div class="absolute -bottom-4 ml-3.5 flex w-full items-center gap-1.5">
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
						class="hidden h-5 cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-gray-400 group-hover:flex hover:flex hover:bg-gray-100 hover:text-gray-500 lg:-right-2 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-300 {isTapped
							? '[@media(hover:none)]:flex'
							: ''}"
						title="Edit"
						type="button"
						onclick={() => {
							if (requireAuthUser()) return;
							editMsdgId = message.id;
						}}
					>
						<CarbonPen />
						Edit
					</button>
					<button
						class="hidden h-5 cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-xs group-hover:flex hover:flex hover:bg-gray-100 lg:-right-2 dark:hover:bg-gray-800 {isTapped
							? '[@media(hover:none)]:flex'
							: ''} {isUserMsgCopied
							? 'text-green-500 dark:text-green-400'
							: 'text-gray-400 hover:text-gray-500 dark:text-gray-400 dark:hover:text-gray-300'}"
						title="Copy to clipboard"
						type="button"
						onclick={async () => {
							try {
								if (window.isSecureContext && navigator.clipboard) {
									await navigator.clipboard.writeText(message.content);
								} else {
									const textArea = document.createElement("textarea");
									textArea.value = message.content;
									document.body.appendChild(textArea);
									textArea.focus();
									textArea.select();
									document.execCommand("copy");
									document.body.removeChild(textArea);
								}
								isUserMsgCopied = true;
								clearTimeout(userCopyTimeout);
								userCopyTimeout = setTimeout(() => {
									isUserMsgCopied = false;
								}, 1000);
							} catch (err) {
								console.error("Failed to copy:", err);
							}
						}}
					>
						{#if isUserMsgCopied}
							<CarbonCheckmark class="scale-[0.85]" />
							Copied
						{:else}
							<CarbonCopy class="scale-[0.85]" />
							Copy
						{/if}
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
