<script lang="ts">
	import file2base64 from "$lib/utils/file2base64";
	import { createEventDispatcher, onMount } from "svelte";

	export let value = "";
	export let minRows = 1;
	export let maxRows: null | number = null;
	export let placeholder = "";
	export let disabled = false;
	export let files: File[] = [];
	// Approximate width from which we disable autofocus
	const TABLET_VIEWPORT_WIDTH = 768;

	let innerWidth = 0;
	let textareaElement: HTMLTextAreaElement;

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

	onMount(() => {
		if (innerWidth > TABLET_VIEWPORT_WIDTH) {
			textareaElement.focus();
		}
	});

	$: sources = files.map((file) => file2base64(file));
</script>

<svelte:window bind:innerWidth />

{#each sources as source}
	{#await source then src}
		<img
			src={`data:image/png;base64,${src}
		`}
			alt="input"
			class="my-2 aspect-auto max-h-24"
		/>
	{/await}
{/each}

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
		on:keypress
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
