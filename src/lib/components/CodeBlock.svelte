<script lang="ts">
	import CopyToClipBoardBtn from "./CopyToClipBoardBtn.svelte";
	import DOMPurify from "isomorphic-dompurify";
	import HtmlPreviewModal from "./HtmlPreviewModal.svelte";
	import PlayFilledAlt from "~icons/carbon/play-filled-alt";
	import EosIconsLoading from "~icons/eos-icons/loading";

	interface Props {
		code?: string;
		rawCode?: string;
		loading?: boolean;
	}

	let { code = "", rawCode = "", loading = false }: Props = $props();

	let previewOpen = $state(false);

	// `code` always comes from our own highlighter (hljs or escapeHTML in
	// marked.ts), which only emits escaped text inside hljs <span> wrappers.
	// While the fence is still streaming (`loading`), the block re-renders on
	// every flush, and re-sanitizing the whole growing block each time is the
	// main-thread hot path of code streaming. Skip DOMPurify during that
	// window only while the html verifiably matches the highlighter's output
	// alphabet (raw `<` may open nothing but a span tag): any other markup —
	// which our highlighter cannot produce — falls back to a full sanitize.
	// Every completed block still gets sanitized as defense in depth.
	const NON_HIGHLIGHTER_TAG = /<(?!\/?span[\s>])/i;
	let sanitizedCode = $derived(
		loading && !NON_HIGHLIGHTER_TAG.test(code) ? code : DOMPurify.sanitize(code)
	);

	function hasStrictHtml5Doctype(input: string): boolean {
		if (!input) return false;
		const withoutBOM = input.replace(/^\uFEFF/, "");
		const trimmed = withoutBOM.trimStart();
		// Strict HTML5 doctype: <!doctype html> with optional whitespace before >
		return /^<!doctype\s+html\s*>/i.test(trimmed);
	}

	function isSvgDocument(input: string): boolean {
		const trimmed = input.trimStart();
		return /^(?:<\?xml[^>]*>\s*)?(?:<!doctype\s+svg[^>]*>\s*)?<svg[\s>]/i.test(trimmed);
	}

	let showPreview = $derived(hasStrictHtml5Doctype(rawCode) || isSvgDocument(rawCode));
</script>

<div class="group relative my-4 rounded-lg">
	<div class="pointer-events-none sticky top-0 w-full">
		<div
			class="pointer-events-auto absolute top-2 right-2 flex items-center gap-1.5 md:top-3 md:right-3"
		>
			{#if showPreview}
				<button
					class="btn h-7 gap-1 rounded-lg border px-2 text-xs shadow-xs backdrop-blur-sm transition-none hover:border-gray-500 active:shadow-inner disabled:cursor-not-allowed disabled:opacity-80 dark:border-gray-600 dark:bg-gray-600/50 dark:hover:border-gray-500"
					disabled={loading}
					onclick={() => {
						if (!loading) {
							previewOpen = true;
						}
					}}
					title="Preview HTML"
					aria-label="Preview HTML"
				>
					{#if loading}
						<EosIconsLoading class="size-3.5" />
					{:else}
						<PlayFilledAlt class="size-3.5" />
					{/if}
					Preview
				</button>
			{/if}
			<CopyToClipBoardBtn
				iconClassNames="size-3"
				classNames="btn transition-none rounded-lg border size-7 text-sm shadow-xs dark:bg-gray-600/50 backdrop-blur-sm dark:hover:border-gray-500  active:shadow-inner dark:border-gray-600  hover:border-gray-500"
				value={rawCode}
			/>
		</div>
	</div>
	<pre class="scrollbar-custom overflow-auto px-5 font-mono transition-[height]"><code
			><!-- eslint-disable svelte/no-at-html-tags -->{@html sanitizedCode}</code
		></pre>

	{#if previewOpen}
		<HtmlPreviewModal html={rawCode} onclose={() => (previewOpen = false)} />
	{/if}
</div>
