<script lang="ts">
	import { browser } from "$app/environment";
	import { createEventDispatcher, onMount } from "svelte";

	import IconInternet from "$lib/components/icons/IconInternet.svelte";
	import CarbonImage from "~icons/carbon/image";
	import CarbonClip from "~icons/carbon/attachment";
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
	import IconTool from "../icons/IconTool.svelte";
	import ToolLogo from "../ToolLogo.svelte";

	export let files: File[] = [];
	export let mimeTypes: string[] = [];

	export let value = "";
	export let placeholder = "";
	export let loading = false;
	export let disabled = false;

	export let assistant: Assistant | undefined = undefined;

	export let modelHasTools = false;

	const onFileChange = async (e: Event) => {
		if (!e.target) return;
		const target = e.target as HTMLInputElement;
		files = [...files, ...(target.files ?? [])];
		await settings.instantSet({
			tools: [...($settings.tools ?? []), documentParserToolId],
		});
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

	$: minHeight = `${1 + 1 * 1.5}em`;
	$: maxHeight = `${1 + 6 * 1.5}em`;

	function handleKeydown(event: KeyboardEvent) {
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
	$: documentParserIsOn = modelHasTools && files.length > 0;

	onMount(() => {
		if (!isVirtualKeyboard()) {
			textareaElement.focus();
		}
	});

	$: extraTools = $page.data.tools.filter((t: ToolFront) =>
		[documentParserToolId, imageGenToolId, webSearchToolId, fetchUrlToolId].includes(t._id)
	) satisfies ToolFront[];
</script>

<div class="relative min-w-0 flex-1" on:paste>
	<pre
		class:mb-8={!assistant}
		class="scrollbar-custom invisible overflow-x-hidden overflow-y-scroll whitespace-pre-wrap break-words p-3"
		aria-hidden="true"
		style="min-height: {minHeight}; max-height: {maxHeight}">{(value || " ") + "\n"}</pre>

	<textarea
		enterkeyhint={!isVirtualKeyboard() ? "enter" : "send"}
		tabindex="0"
		rows="1"
		class="scrollbar-custom absolute top-0 m-0 h-full w-full resize-none scroll-p-3 overflow-x-hidden overflow-y-scroll border-0 bg-transparent p-3 outline-none focus:ring-0 focus-visible:ring-0 max-sm:p-2.5 max-sm:text-[16px]"
		class:text-gray-400={disabled}
		bind:value
		bind:this={textareaElement}
		{disabled}
		on:keydown={handleKeydown}
		on:compositionstart={() => (isCompositionOn = true)}
		on:compositionend={() => (isCompositionOn = false)}
		on:beforeinput
		{placeholder}
	/>

	{#if !assistant}
		<div
			class="mt-auto flex h-8 w-full flex-wrap items-center justify-start gap-2 p-3 text-smd text-gray-500 dark:text-gray-400"
		>
			<button
				class="flex items-center gap-1 transition-all hover:text-gray-400 dark:hover:text-gray-300"
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
				<IconInternet />
				{#if webSearchIsOn}
					Search
				{/if}
			</button>
			{#if modelHasTools}
				<button
					class="flex items-center gap-1 transition-all hover:text-gray-400 dark:hover:text-gray-300"
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
					<CarbonImage />
					{#if imageGenIsOn}
						Image Gen
					{/if}
				</button>
				<button
					class="flex items-center gap-1 transition-all hover:text-gray-400 dark:hover:text-gray-300"
					class:active-tool={documentParserIsOn}
					disabled={loading}
				>
					<input
						class="absolute w-full cursor-pointer opacity-0"
						aria-label="Upload file"
						type="file"
						on:change={onFileChange}
						accept={mimeTypes.join(",")}
					/>
					<CarbonClip />
					{#if documentParserIsOn}
						Document Parser
					{/if}
				</button>
				{#each extraTools as tool}
					<button
						class="active-tool flex items-center gap-1 transition-all hover:text-gray-400 dark:hover:text-gray-300"
						disabled={loading}
					>
						<ToolLogo icon={tool.icon} color={tool.color} size="xs" />
						{tool.displayName}
					</button>
				{/each}
			{/if}
		</div>
	{/if}
</div>

<style lang="postcss">
	pre,
	textarea {
		font-family: inherit;
		box-sizing: border-box;
		line-height: 1.5;
	}

	.active-tool {
		@apply my-0 rounded-full border border-purple-300 bg-purple-400/20 px-2 text-purple-700 dark:border-purple-600 dark:text-purple-400;
	}
</style>
