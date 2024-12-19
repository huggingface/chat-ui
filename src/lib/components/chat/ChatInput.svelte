<script lang="ts">
	import { browser } from "$app/environment";
	import { createEventDispatcher, onMount } from "svelte";

	import IconInternet from "$lib/components/icons/IconInternet.svelte";
	import CarbonImage from "~icons/carbon/image";
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
			class="scrollbar-custom max-h-[96em] w-full resize-none scroll-p-3 overflow-y-auto overflow-x-hidden border-0 bg-transparent p-3 pb-1 outline-none focus:ring-0 focus-visible:ring-0 max-sm:p-2.5 max-sm:text-[16px]"
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
			class="flex w-full flex-wrap items-center justify-start gap-2 p-3 py-1 text-smd text-gray-500 dark:text-gray-400"
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
				<IconInternet />
				{#if webSearchIsOn}
					Search
				{/if}
			</button>
			{#if modelHasTools}
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
					<CarbonImage />
					{#if imageGenIsOn}
						Image Gen
					{/if}
				</button>
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
			{#if modelIsMultimodal || modelHasTools}
				<form>
					<button
						class="base-tool relative"
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
						<svg
							width="14"
							height="14"
							viewBox="0 0 10 11"
							fill="none"
							xmlns="http://www.w3.org/2000/svg"
						>
							<path
								d="M6.52896 3.07175L3.35489 6.24582C3.16063 6.44008 3.05149 6.70356 3.05149 6.97829C3.05149 7.25303 3.16063 7.51651 3.35489 7.71077C3.54916 7.90503 3.81264 8.01417 4.08737 8.01417C4.3621 8.01417 4.62558 7.90503 4.81984 7.71077L7.99391 4.53671C8.38244 4.14818 8.60071 3.62122 8.60071 3.07175C8.60071 2.52229 8.38244 1.99533 7.99391 1.6068C7.60538 1.21827 7.07842 1 6.52896 1C5.97949 1 5.45253 1.21827 5.064 1.6068L1.88994 4.78087C1.30715 5.36366 0.979736 6.1541 0.979736 6.97829C0.979736 7.80249 1.30715 8.59293 1.88994 9.17572C2.47273 9.75852 3.26317 10.0859 4.08737 10.0859C4.91156 10.0859 5.702 9.75852 6.2848 9.17572L9.45886 6.00166"
								class="stroke-current stroke-[0.75]"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
						{#if documentParserIsOn}
							Document Parser
						{/if}
					</button>
				</form>
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

	.base-tool {
		@apply flex h-fit min-h-7 items-center gap-1 transition-all hover:text-gray-400 dark:hover:text-gray-300;
	}

	.active-tool {
		@apply my-0 rounded-full border border-purple-300 bg-purple-400/20 px-2 text-purple-700 hover:text-purple-600 dark:border-purple-600 dark:text-purple-400 dark:hover:text-purple-300;
	}
</style>
