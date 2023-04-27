<script lang="ts">
	import { createEventDispatcher } from "svelte";

	export let value = "";
	export let minRows = 1;
	export let maxRows: null | number = null;
	export let placeholder = "";
	export let disabled = false;
	export let autofocus = false;

	const dispatch = createEventDispatcher<{ submit: void }>();

	$: minHeight = `${1 + minRows * 1.5}em`;
	$: maxHeight = maxRows ? `${1 + maxRows * 1.5}em` : `auto`;

	function handleKeydown(event: KeyboardEvent) {
		// submit on enter
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			dispatch("submit"); // use a custom event instead of `event.target.form.requestSubmit()` as it does not work on Safari 14
		}
	}

	let textareaElement: HTMLTextAreaElement;
</script>

<div class="relative min-w-0 flex-1">
	<pre
		class="invisible py-3"
		aria-hidden="true"
		style="min-height: {minHeight}; max-height: {maxHeight}">{value + "&nbsp;\n"}</pre>

	<textarea
		enterkeyhint="send"
		tabindex="0"
		rows="1"
		class="scrollbar-custom absolute top-0 m-0 h-full w-full resize-none overflow-x-hidden overflow-y-scroll border-0 bg-transparent p-3 outline-none focus:ring-0 focus-visible:ring-0 dark:bg-transparent"
		bind:value
		bind:this={textareaElement}
		{disabled}
		on:keydown={handleKeydown}
		{placeholder}
		{autofocus}
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
