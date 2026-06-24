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
	let preEl = $state<HTMLPreElement | null>(null);
	// Pause auto-scroll once the user scrolls up to read earlier lines, so we
	// don't fight them while tokens keep streaming in.
	let userScrolled = $state(false);

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

	function handleScroll() {
		if (!preEl) return;
		const distanceFromBottom = preEl.scrollHeight - preEl.scrollTop - preEl.clientHeight;
		userScrolled = distanceFromBottom > 10;
	}

	$effect(() => {
		// Re-run on every streamed chunk by reading code.
		code;
		if (loading && preEl && !userScrolled) {
			preEl.scrollTop = preEl.scrollHeight;
		}
	});
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
	<pre
		bind:this={preEl}
		onscroll={handleScroll}
		class="scrollbar-custom overflow-auto px-5 font-mono transition-[height]"
		class:max-h-96={loading}><code
			><!-- eslint-disable svelte/no-at-html-tags -->{@html DOMPurify.sanitize(code)}</code
		></pre>

	{#if previewOpen}
		<HtmlPreviewModal html={rawCode} onclose={() => (previewOpen = false)} />
	{/if}
</div>
