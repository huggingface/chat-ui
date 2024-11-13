<script lang="ts">
	import { browser } from "$app/environment";
	import { createEventDispatcher } from "svelte";
	import MarkdownEditor from "./MarkdownEditor.svelte";

	export let value = "";
	export let minRows = 1;
	export let maxRows: null | number = null;
	export let placeholder = "";
	export let disabled = false;

	const dispatch = createEventDispatcher<{ submit: void }>();

	function isVirtualKeyboard(): boolean {
		if (!browser) return false;
		if (navigator.maxTouchPoints > 0) return true;
		if ("ontouchstart" in window) return true;
		const userAgent = navigator.userAgent.toLowerCase();
		return /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
	}

	$: minHeight = `${minRows * 1.5}em`;
	$: maxHeight = maxRows ? `${maxRows * 1.5}em` : `auto`;

	let editor: MarkdownEditor;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	function handleKeyDown(view: any, event: KeyboardEvent) {
		if (event.key === "Enter") {
			const node = view.state.selection.$from.parent;

			if (node.type.name === "codeBlock") {
				// Let Tiptap handle the newline
				return false;
			}

			if (!event.shiftKey) {
				const text = value.trim();
				if (text) {
					dispatch("submit");
				}
				event.preventDefault();
				return true;
			}
		}
		return false;
	}
</script>

<div class="relative min-w-0 flex-1" on:paste>
	<MarkdownEditor
		bind:this={editor}
		bind:value
		{placeholder}
		{disabled}
		{minHeight}
		{maxHeight}
		autofocus={!isVirtualKeyboard()}
		{handleKeyDown}
	/>
</div>
