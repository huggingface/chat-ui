<script lang="ts">
	import { onMount, tick } from "svelte";

	import HoverTooltip from "$lib/components/HoverTooltip.svelte";
	import IconPaperclip from "$lib/components/icons/IconPaperclip.svelte";
	import { page } from "$app/state";
	import { loginModalOpen } from "$lib/stores/loginModal";

	import { isVirtualKeyboard } from "$lib/utils/isVirtualKeyboard";
	interface Props {
		files?: File[];
		mimeTypes?: string[];
		value?: string;
		placeholder?: string;
		loading?: boolean;
		disabled?: boolean;
		// tools removed
		modelIsMultimodal?: boolean;
		children?: import("svelte").Snippet;
		onPaste?: (e: ClipboardEvent) => void;
		focused?: boolean;
		onsubmit?: () => void;
	}

	let {
		files = $bindable([]),
		mimeTypes = [],
		value = $bindable(""),
		placeholder = "",
		loading = false,
		disabled = false,

		modelIsMultimodal = false,
		children,
		onPaste,
		focused = $bindable(false),
		onsubmit,
	}: Props = $props();

	const onFileChange = async (e: Event) => {
		if (!e.target) return;
		const target = e.target as HTMLInputElement;
		files = [...files, ...(target.files ?? [])];
	};

	let textareaElement: HTMLTextAreaElement | undefined = $state();
	let isCompositionOn = $state(false);

	onMount(() => {
		if (!isVirtualKeyboard()) {
			textareaElement?.focus();
		}
		function onFormSubmit() {
			adjustTextareaHeight();
		}

		const formEl = textareaElement?.closest("form");
		formEl?.addEventListener("submit", onFormSubmit);
		return () => {
			formEl?.removeEventListener("submit", onFormSubmit);
		};
	});

	function adjustTextareaHeight() {
		if (!textareaElement) {
			return;
		}

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
			adjustTextareaHeight();
			tick();
			onsubmit?.();
		}
	}

	// Tools removed; only show file upload when applicable
	let showFileUpload = $derived(modelIsMultimodal && mimeTypes.length > 0);
	let showNoTools = $derived(!showFileUpload);
</script>

<div class="flex min-h-full flex-1 flex-col" onpaste={onPaste}>
	<textarea
		rows="1"
		tabindex="0"
		inputmode="text"
		class="scrollbar-custom max-h-[4lh] w-full resize-none overflow-y-auto overflow-x-hidden border-0 bg-transparent px-2.5 py-2.5 outline-none focus:ring-0 focus-visible:ring-0 sm:px-3 md:max-h-[8lh]"
		class:text-gray-400={disabled}
		bind:value
		bind:this={textareaElement}
		onkeydown={handleKeydown}
		oncompositionstart={() => (isCompositionOn = true)}
		oncompositionend={() => (isCompositionOn = false)}
		oninput={adjustTextareaHeight}
		onbeforeinput={(ev) => {
			if (page.data.loginRequired) {
				ev.preventDefault();
				$loginModalOpen = true;
			}
		}}
		{placeholder}
		{disabled}
		onfocus={() => (focused = true)}
		onblur={() => (focused = false)}
	></textarea>

	{#if !showNoTools}
		<div
			class={[
				"scrollbar-custom -ml-0.5 flex max-w-[calc(100%-40px)] flex-wrap items-center justify-start gap-2.5 px-3 pb-2.5 pt-1.5 text-gray-500 dark:text-gray-400 max-md:flex-nowrap max-md:overflow-x-auto sm:gap-2",
			]}
		>
			{#if showFileUpload}
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
				<div class="flex items-center">
					<HoverTooltip
						label={mimeTypesString.includes("*")
							? "Upload any file"
							: `Upload ${mimeTypesString} files`}
						position="top"
						TooltipClassNames="text-xs !text-left !w-auto whitespace-nowrap !py-1 !mb-0 max-sm:hidden"
					>
						<label class="base-tool relative">
							<input
								disabled={loading}
								class="absolute hidden size-0"
								aria-label="Upload file"
								type="file"
								onchange={onFileChange}
								accept={mimeTypes.join(",")}
							/>
							<IconPaperclip classNames="text-xl" />
						</label>
					</HoverTooltip>
				</div>
			{/if}
		</div>
	{/if}
	{@render children?.()}
</div>

<style lang="postcss">
	:global(pre),
	:global(textarea) {
		font-family: inherit;
		box-sizing: border-box;
		line-height: 1.5;
		font-size: 16px;
	}
</style>
