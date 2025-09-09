<script lang="ts">
	import CopyToClipBoardBtn from "./CopyToClipBoardBtn.svelte";
	import DOMPurify from "isomorphic-dompurify";
	import PlayFilledAlt from "~icons/carbon/play-filled-alt";
	import HtmlPreviewModal from "./HtmlPreviewModal.svelte";

	interface Props {
		code?: string;
		rawCode?: string;
		disabled?: boolean;
	}

	let { code = "", rawCode = "", disabled = false }: Props = $props();

	let previewOpen = $state(false);

	function hasStrictHtml5Doctype(input: string): boolean {
		if (!input) return false;
		const withoutBOM = input.replace(/^\uFEFF/, "");
		const trimmed = withoutBOM.trimStart();
		// Strict HTML5 doctype: <!doctype html> with optional whitespace before >
		return /^<!doctype\s+html\s*>/i.test(trimmed);
	}

	let showPreview = $derived(hasStrictHtml5Doctype(rawCode));
</script>

<div class="group relative my-4 rounded-lg">
	<pre
		class="scrollbar-custom overflow-auto px-5 font-mono scrollbar-thumb-gray-500 hover:scrollbar-thumb-gray-400 dark:scrollbar-thumb-white/10 dark:hover:scrollbar-thumb-white/20"><code
			><!-- eslint-disable svelte/no-at-html-tags -->{@html DOMPurify.sanitize(code)}</code
		></pre>
	<div class="absolute right-2 top-2 flex items-center gap-1.5">
		{#if showPreview}
			<button
				class="btn h-7 gap-1 rounded-lg border border-gray-200 px-2 text-xs text-gray-200 shadow-sm transition-all hover:border-gray-300 active:shadow-inner disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-500"
				onclick={() => (previewOpen = true)}
				title="Preview HTML"
				aria-label="Preview HTML"
				{disabled}
				aria-disabled={disabled}
			>
				<PlayFilledAlt class="text-[0.6rem]" />
				Preview
			</button>
		{/if}
		<CopyToClipBoardBtn
			iconClassNames="size-3"
			classNames="btn rounded-lg border border-gray-200 size-7 text-sm shadow-sm transition-all hover:border-gray-300 active:shadow-inner dark:border-gray-700 dark:hover:border-gray-500  dark:text-gray-400 text-gray-200"
			value={rawCode}
		/>
	</div>

	{#if previewOpen}
		<HtmlPreviewModal html={rawCode} on:close={() => (previewOpen = false)} />
	{/if}
</div>
