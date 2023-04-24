<script lang="ts">
	export let value = "";
	export let minRows = 1;
	export let maxRows: null | number = null;
	export let placeholder = "";
	export let disabled = false;
	export let autofocus = false;

	$: minHeight = `${1 + minRows * 1.5}em`;
	$: maxHeight = maxRows ? `${1 + maxRows * 1.5}em` : `auto`;

	function handleKeydown(event: KeyboardEvent) {
		// submit on enter
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();

			textareaElement.closest("form")?.requestSubmit();
		}
	}

	let textareaElement: HTMLTextAreaElement;
</script>

<div class="relative flex-1 min-w-0">
	<pre
		class="invisible py-3"
		aria-hidden="true"
		style="min-height: {minHeight}; max-height: {maxHeight}">{value + "&nbsp;\n"}</pre>

	<textarea
		enterkeyhint="send"
		tabindex="0"
		rows="1"
		class="absolute m-0 w-full h-full top-0 resize-none border-0 bg-transparent p-3 focus:ring-0 focus-visible:ring-0 dark:bg-transparent outline-none scrollbar-custom overflow-x-hidden overflow-y-scroll"
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
