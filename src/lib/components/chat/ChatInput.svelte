<script lang="ts">
	import { browser } from "$app/environment";
	import { createEventDispatcher, onMount } from "svelte";

	export let value = "";
	export let minRows = 1;
	export let maxRows: null | number = null;
	export let placeholder = "";
	export let disabled = false;

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

	$: minHeight = `${1 + minRows * 1.5}em`;
	$: maxHeight = maxRows ? `${1 + maxRows * 1.5}em` : `auto`;

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

	onMount(() => {
		if (!isVirtualKeyboard()) {
			textareaElement.focus();
		}
	});
</script>

<div class="relative min-w-0 flex-1" on:paste>
	<pre
		class="scrollbar-custom invisible overflow-x-hidden overflow-y-scroll whitespace-pre-wrap break-words p-3"
		aria-hidden="true"
		style="min-height: {minHeight}; max-height: {maxHeight}">{(value || " ") + "\n"}</pre>

	<textarea
		enterkeyhint={!isVirtualKeyboard() ? "enter" : "send"}
		tabindex="0"
		rows="1"
		class="scrollbar-custom absolute top-0 m-0 h-full w-full resize-none scroll-p-3 overflow-x-hidden overflow-y-scroll border-0 bg-transparent p-3 outline-none focus:ring-0 focus-visible:ring-0"
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
</div>

<style>
	pre,
	textarea {
		font-family: inherit;
		box-sizing: border-box;
		line-height: 1.5;
	}
</style>
