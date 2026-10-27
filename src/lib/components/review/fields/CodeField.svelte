<script lang="ts">
	import DOMPurify from "isomorphic-dompurify";
	import { escapeHTML } from "$lib/utils/markedLight";

	interface Props {
		value: string;
		language?: string;
		clamp?: boolean;
	}

	let { value, language, clamp = false }: Props = $props();

	// lazy so the highlighter chunk stays out of the entry bundle
	let highlightCode = $state<(text: string, lang?: string) => string>();
	$effect(() => {
		if (highlightCode) return;
		import("$lib/utils/marked")
			.then((markedModule) => (highlightCode = markedModule.highlightCode))
			.catch(() => (highlightCode = (text: string) => escapeHTML(text)));
	});

	let html = $derived(
		DOMPurify.sanitize((highlightCode ?? ((text: string) => escapeHTML(text)))(value, language))
	);
</script>

<pre
	class={[
		"m-0 scrollbar-custom overflow-x-auto rounded-lg bg-gray-50 px-3 py-2 font-mono text-xs leading-relaxed text-gray-700 dark:bg-gray-800 dark:text-gray-200",
		clamp && "max-h-24 overflow-y-hidden",
	]}><!-- eslint-disable-next-line svelte/no-at-html-tags -->
<code class="hljs bg-transparent!">{@html html}</code></pre>
