<script lang="ts">
	import { browser } from "$app/environment";
	import { createEventDispatcher, onMount } from "svelte";

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
	import { captureScreen } from "$lib/utils/screenshot";
	import IconScreenshot from "../icons/IconScreenshot.svelte";

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

	onMount(() => {
		if (!isVirtualKeyboard()) {
			textareaElement.focus();
		}
		function onFormSubmit() {
			adjustTextareaHeight();
		}

		const formEl = textareaElement.closest("form");
		formEl?.addEventListener("submit", onFormSubmit);
		return () => {
			formEl?.removeEventListener("submit", onFormSubmit);
		};
	});

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
		textareaElement.style.height = "auto";
		textareaElement.style.height = `${textareaElement.scrollHeight}px`;

		if (textareaElement.selectionStart === textareaElement.value.length) {
			textareaElement.scrollTop = textareaElement.scrollHeight;
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (
			event.key === "Enter" &&
			!event.shiftKey &&
			!isCompositionOn &&
			!isVirtualKeyboard() &&
			value.trim() !== ""
		) {
			event.preventDefault();
			dispatch("submit");
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

	$: extraTools = $page.data.tools
		.filter((t: ToolFront) => $settings.tools?.includes(t._id))
		.filter(
			(t: ToolFront) =>
				![documentParserToolId, imageGenToolId, webSearchToolId, fetchUrlToolId].includes(t._id)
		) satisfies ToolFront[];
</script>

<div class="flex min-h-full flex-1 flex-col" on:paste>
	<textarea
		rows="1"
		tabindex="0"
		inputmode="text"
		class="scrollbar-custom max-h-[4lh] w-full resize-none overflow-y-auto overflow-x-hidden border-0 bg-transparent px-2.5 py-2.5 outline-none focus:ring-0 focus-visible:ring-0 max-sm:text-[16px] sm:px-3"
		class:text-gray-400={disabled}
		bind:value
		bind:this={textareaElement}
		on:keydown={handleKeydown}
		on:compositionstart={() => (isCompositionOn = true)}
		on:compositionend={() => (isCompositionOn = false)}
		on:input={adjustTextareaHeight}
		on:beforeinput
		{placeholder}
		{disabled}
	/>

	{#if !assistant}
		<div
			class="scrollbar-custom -ml-0.5 flex max-w-[calc(100%-40px)] flex-wrap items-center justify-start gap-2.5 px-3 pb-2.5 pt-1.5 text-gray-500 dark:text-gray-400 max-md:flex-nowrap max-md:overflow-x-auto sm:gap-2"
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
						label={mimeTypesString.includes("*")
							? "Upload any file"
							: `Upload ${mimeTypesString} files`}
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
				{#if mimeTypes.includes("image/*")}
					<HoverTooltip
						label="Capture screenshot"
						position="top"
						TooltipClassNames="text-xs !text-left !w-auto whitespace-nowrap !py-1 !mb-0 max-sm:hidden"
					>
						<button
							class="base-tool"
							on:click|preventDefault={async () => {
								const screenshot = await captureScreen();

								// Convert base64 to blob
								const base64Response = await fetch(screenshot);
								const blob = await base64Response.blob();

								// Create a File object from the blob
								const file = new File([blob], "screenshot.png", { type: "image/png" });

								files = [...files, file];
							}}
						>
							<IconScreenshot classNames="text-xl" />
						</button>
					</HoverTooltip>
				{/if}
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
						class="base-tool flex !size-[20px] items-center justify-center rounded-full border !border-gray-200 !bg-white !transition-none dark:!border-gray-500 dark:!bg-transparent"
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
		@apply flex h-[1.6rem] items-center gap-[.2rem] whitespace-nowrap border border-transparent text-xs outline-none transition-all focus:outline-none active:outline-none dark:hover:text-gray-300 sm:hover:text-purple-600;
	}

	.active-tool {
		@apply rounded-full !border-purple-200 bg-purple-100 pl-1 pr-2 text-purple-600 hover:text-purple-600  dark:!border-purple-700 dark:bg-purple-600/40 dark:text-purple-200;
	}
</style>
