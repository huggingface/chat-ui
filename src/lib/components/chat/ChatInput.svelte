<script lang="ts">
	import { isDesktop } from "$lib/utils/isDesktop";
	import { createEventDispatcher, onMount } from "svelte";

	export let value = "";
	export let minRows = 1;
	export let maxRows: null | number = null;
	export let placeholder = "";
	export let disabled = false;

	let textareaElement: HTMLTextAreaElement;
	let isCompositionOn = false;

	const dispatch = createEventDispatcher<{ submit: void }>();

	$: minHeight = `${1 + minRows * 1.5}em`;
	$: maxHeight = maxRows ? `${1 + maxRows * 1.5}em` : `auto`;

	function handleKeydown(event: KeyboardEvent) {
		// submit on enter
		if (event.key === "Enter" && !event.shiftKey && !isCompositionOn) {
			event.preventDefault();
			// blur to close keyboard on mobile
			textareaElement.blur();
			// refocus so that user on desktop can start typing without needing to reclick on textarea
			if (isDesktop(window)) {
				textareaElement.focus();
			}
			dispatch("submit"); // use a custom event instead of `event.target.form.requestSubmit()` as it does not work on Safari 14
		}
	}

	onMount(() => {
		if (isDesktop(window)) {
			textareaElement.focus();
		}
	});
</script>

<div class="relative min-w-0 flex-1">
	<pre
		class="scrollbar-custom invisible overflow-x-hidden overflow-y-scroll whitespace-pre-wrap break-words p-3"
		aria-hidden="true"
		style="min-height: {minHeight}; max-height: {maxHeight}">{(value || " ") + "\n"}</pre>

	<textarea
		enterkeyhint="send"
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
