<script lang="ts">
	import { browser } from "$app/environment";
	import { createEventDispatcher, onMount, tick } from "svelte";

	import HoverTooltip from "$lib/components/HoverTooltip.svelte";
	import IconInternet from "$lib/components/icons/IconInternet.svelte";
	import IconImageGen from "$lib/components/icons/IconImageGen.svelte";
	import IconPaperclip from "$lib/components/icons/IconPaperclip.svelte";
	import { useSettingsStore } from "$lib/stores/settings";
	import { webSearchParameters } from "$lib/stores/webSearchParameters";
	import {
		documentParserToolId,
		fetchUrlToolId,
		imageGenToolId,
		webSearchToolId,
	} from "$lib/utils/toolIds";
	import type { Assistant } from "$lib/types/Assistant";
	import { page } from "$app/stores";
	import type { ToolFront } from "$lib/types/Tool";
	import ToolLogo from "../ToolLogo.svelte";
	import { goto } from "$app/navigation";
	import { base } from "$app/paths";
	import IconAdd from "~icons/carbon/add";

	export let files: File[] = [];
	export let mimeTypes: string[] = [];

	export let value = "";
	export let placeholder = "";
	export let loading = false;
	export let disabled = false;

	export let assistant: Assistant | undefined = undefined;

	export let modelHasTools = false;
	export let modelIsMultimodal = false;

	const onFileChange = async (e: Event) => {
		if (!e.target) return;
		const target = e.target as HTMLInputElement;
		files = [...files, ...(target.files ?? [])];

		if (files.some((file) => file.type.startsWith("application/"))) {
			await settings.instantSet({
				tools: [...($settings.tools ?? []), documentParserToolId],
			});
		}
	};

	let textareaElement: HTMLTextAreaElement;
	let isCompositionOn = false;

	const dispatch = createEventDispatcher<{ submit: void }>();

	function isVirtualKeyboard(): boolean {
		if (!browser) return false;

		// Check for touch capability
		if (navigator.maxTouchPoints > 0) return true;

		// Check for touch events
		if ("ontouchstart" in window) return true;

		// Fallback to user agent string check
		const userAgent = navigator.userAgent.toLowerCase();

		return /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
	}

	function adjustTextareaHeight() {
		if (!textareaElement) return;
		textareaElement.style.height = "auto";
		const newHeight = Math.min(textareaElement.scrollHeight, parseInt("96em"));
		textareaElement.style.height = `${newHeight}px`;
		if (!textareaElement.parentElement) return;
		textareaElement.parentElement.style.height = `${newHeight}px`;
	}

	async function handleKeydown(event: KeyboardEvent) {
		if (event.key === "Enter" && !event.shiftKey && !isCompositionOn) {
			event.preventDefault();
			if (isVirtualKeyboard()) {
				// Insert a newline at the cursor position
				const start = textareaElement.selectionStart;
				const end = textareaElement.selectionEnd;
				value = value.substring(0, start) + "\n" + value.substring(end);
				textareaElement.selectionStart = textareaElement.selectionEnd = start + 1;
			} else {
				if (value.trim() !== "") {
					dispatch("submit");
					await tick();
					adjustTextareaHeight();
				}
			}
		}
	}

	const settings = useSettingsStore();

	// tool section

	$: webSearchIsOn = modelHasTools
		? ($settings.tools?.includes(webSearchToolId) ?? false) ||
		  ($settings.tools?.includes(fetchUrlToolId) ?? false)
		: $webSearchParameters.useSearch;
	$: imageGenIsOn = $settings.tools?.includes(imageGenToolId) ?? false;

	$: documentParserIsOn =
		modelHasTools && files.length > 0 && files.some((file) => file.type.startsWith("application/"));

	onMount(() => {
		if (!isVirtualKeyboard()) {
			textareaElement.focus();
		}
		adjustTextareaHeight();
	});

	$: extraTools = $page.data.tools
		.filter((t: ToolFront) => $settings.tools?.includes(t._id))
		.filter(
			(t: ToolFront) =>
				![documentParserToolId, imageGenToolId, webSearchToolId, fetchUrlToolId].includes(t._id)
		) satisfies ToolFront[];
</script>

<div class="min-h-full flex-1" on:paste>
	<div class="relative w-full min-w-0">
		<textarea
			enterkeyhint={!isVirtualKeyboard() ? "enter" : "send"}
			tabindex="0"
			rows="1"
			class="scrollbar-custom max-h-[96em] w-full resize-none scroll-p-3 overflow-y-auto overflow-x-hidden border-0 bg-transparent px-3 py-2.5 outline-none focus:ring-0 focus-visible:ring-0 max-sm:p-2.5 max-sm:text-[16px]"
			class:text-gray-400={disabled}
			bind:value
			bind:this={textareaElement}
			{disabled}
			on:keydown={handleKeydown}
			on:compositionstart={() => (isCompositionOn = true)}
			on:compositionend={() => (isCompositionOn = false)}
			on:input={adjustTextareaHeight}
			on:beforeinput
			{placeholder}
		/>
	</div>
	{#if !assistant}
		<div
			class="scrollbar-custom -ml-0.5 flex max-w-[calc(100%-40px)] flex-wrap items-center justify-start gap-2 px-3 pb-2.5 pt-0.5 text-gray-500
			dark:text-gray-400 max-md:flex-nowrap max-md:overflow-x-auto sm:gap-2.5"
		>
			<HoverTooltip
				label="Search the web"
				position="top"
				TooltipClassNames="text-xs !text-left !w-auto whitespace-nowrap !py-1 !mb-0 max-sm:hidden {webSearchIsOn
					? 'hidden'
					: ''}"
			>
				<button
					class="base-tool"
					class:active-tool={webSearchIsOn}
					disabled={loading}
					on:click|preventDefault={async () => {
						if (modelHasTools) {
							if (webSearchIsOn) {
								await settings.instantSet({
									tools: ($settings.tools ?? []).filter(
										(t) => t !== webSearchToolId && t !== fetchUrlToolId
									),
								});
							} else {
								await settings.instantSet({
									tools: [...($settings.tools ?? []), webSearchToolId, fetchUrlToolId],
								});
							}
						} else {
							$webSearchParameters.useSearch = !webSearchIsOn;
						}
					}}
				>
					<IconInternet classNames="text-xl" />
					{#if webSearchIsOn}
						Search
					{/if}
				</button>
			</HoverTooltip>
			{#if modelHasTools}
				<HoverTooltip
					label="Generate	images"
					position="top"
					TooltipClassNames="text-xs !text-left !w-auto whitespace-nowrap !py-1 !mb-0 max-sm:hidden {imageGenIsOn
						? 'hidden'
						: ''}"
				>
					<button
						class="base-tool"
						class:active-tool={imageGenIsOn}
						disabled={loading}
						on:click|preventDefault={async () => {
							if (modelHasTools) {
								if (imageGenIsOn) {
									await settings.instantSet({
										tools: ($settings.tools ?? []).filter((t) => t !== imageGenToolId),
									});
								} else {
									await settings.instantSet({
										tools: [...($settings.tools ?? []), imageGenToolId],
									});
								}
							}
						}}
					>
						<IconImageGen classNames="text-xl" />
						{#if imageGenIsOn}
							Image Gen
						{/if}
					</button>
				</HoverTooltip>
			{/if}
			{#if modelIsMultimodal || modelHasTools}
				{@const mimeTypesString = mimeTypes
					.map((m) => {
						// if the mime type ends in *, grab the first part so image/* becomes image
						if (m.endsWith("*")) {
							return m.split("/")[0];
						}
						// otherwise, return the second part for example application/pdf becomes pdf
						return m.split("/")[1];
					})
					.join(", ")}
				<form class="flex items-center">
					<HoverTooltip
						label={`Upload ${mimeTypesString} files`}
						position="top"
						TooltipClassNames="text-xs !text-left !w-auto whitespace-nowrap !py-1 !mb-0 max-sm:hidden"
					>
						<label class="base-tool relative" class:active-tool={documentParserIsOn}>
							<input
								disabled={loading}
								class="absolute hidden size-0"
								aria-label="Upload file"
								type="file"
								on:change={onFileChange}
								accept={mimeTypes.join(",")}
							/>
							<IconPaperclip classNames="text-xl" />
							{#if documentParserIsOn}
								Document Parser
							{/if}
						</label>
					</HoverTooltip>
				</form>
			{/if}
			{#if modelHasTools}
				{#each extraTools as tool}
					<button
						class="active-tool base-tool"
						disabled={loading}
						on:click|preventDefault={async () => {
							goto(`${base}/tools/${tool._id}`);
						}}
					>
						<ToolLogo icon={tool.icon} color={tool.color} size="xs" />
						{tool.displayName}
					</button>
				{/each}
			{/if}
			{#if modelHasTools}
				<HoverTooltip
					label="Browse more tools"
					position="right"
					TooltipClassNames="text-xs !text-left !w-auto whitespace-nowrap !py-1 max-sm:hidden"
				>
					<a
						class="base-tool flex !size-[20px] items-center justify-center rounded-full bg-white/10"
						href={`${base}/tools`}
						title="Browse more tools"
					>
						<IconAdd class="text-sm" />
					</a>
				</HoverTooltip>
			{/if}
		</div>
	{/if}
	<slot />
</div>

<style lang="postcss">
	pre,
	textarea {
		font-family: inherit;
		box-sizing: border-box;
		line-height: 1.5;
	}

	.base-tool {
		@apply flex h-[1.6rem] items-center gap-[.2rem] whitespace-nowrap text-xs outline-none transition-all focus:outline-none active:outline-none dark:hover:text-gray-300 sm:hover:text-purple-600;
	}

	.active-tool {
		@apply rounded-full bg-purple-500/15 pl-1 pr-2 text-purple-600 hover:text-purple-600  dark:bg-purple-600/40 dark:text-purple-300;
	}
</style>
