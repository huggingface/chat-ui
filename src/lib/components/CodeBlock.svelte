<script lang="ts">
	import { onMount } from "svelte";
	import { afterUpdate } from "svelte";
	import CopyToClipBoardBtn from "./CopyToClipBoardBtn.svelte";
	import MermaidLiveBtn from "./MermaidLiveBtn.svelte";
	import DOMPurify from "isomorphic-dompurify";
	import mermaid from "mermaid";
	import { default as hljs } from "highlight.js";
	import type { RenderResult } from "mermaid";

	export let code = "";
	export let lang = "";
	export let loading = false;

	let highlightedCode = "";
	let mermaidId = `mermaid-${Math.random().toString(36).slice(2, 9)}`;
	let mermaidError: string | null = null;
	let renderPromise: Promise<RenderResult | null> | null = null;

	onMount(() => {
		mermaid.initialize({
			startOnLoad: false,
			securityLevel: "antiscript",
			theme: "dark" === localStorage.theme ? "dark" : "default",
		});

		mermaid.parseError = (err, hash) => {
			mermaidError = `Parse error: ${err}`;
			if (hash && hash.loc) {
				mermaidError += ` (Line ${hash.loc.first_line}, Column ${hash.loc.first_column})`;
			}
		};
	});

	$: if (lang === "mermaid" && !loading && code) {
		mermaidError = null;
		renderPromise = mermaid.render(mermaidId, code).catch((error) => {
			mermaidError = `Error rendering diagram: ${error.message}`;
			return null;
		});
	} else {
		renderPromise = null;
		mermaidError = null;
	}

	afterUpdate(async () => {
		const language = hljs.getLanguage(lang);
		highlightedCode = hljs.highlightAuto(code, language?.aliases).value;
	});
</script>

<div class="group relative my-4 rounded-lg">
	{#if lang === "mermaid" && !loading}
		{#await renderPromise}
			<pre>{code}</pre>
		{:then result}
			{#if result && result.svg && !mermaidError}
				{@html result.svg}
			{:else}
				<pre>{DOMPurify.sanitize(code)}</pre>
				<p class="text-red-500">
					{mermaidError || "Unknown error rendering diagram. Please check your syntax."}
				</p>
			{/if}
		{/await}
	{:else}
		<pre
			class="scrollbar-custom overflow-auto px-5 scrollbar-thumb-gray-500 hover:scrollbar-thumb-gray-400 dark:scrollbar-thumb-white/10 dark:hover:scrollbar-thumb-white/20">
<code class="language-{lang}"
				>{@html DOMPurify.sanitize(highlightedCode) || code.replaceAll("<", "&lt;")}</code
			>
        </pre>
	{/if}
	<CopyToClipBoardBtn
		classNames="btn rounded-lg border border-gray-200 px-2 py-2 text-sm shadow-sm transition-all hover:border-gray-300 active:shadow-inner dark:border-gray-700 dark:hover:border-gray-500 absolute top-2 right-2 invisible opacity-0 group-hover:visible group-hover:opacity-100 dark:text-gray-700 text-gray-200"
		value={code}
	/>
	{#if lang === "mermaid"}
		<MermaidLiveBtn
			classNames="btn rounded-lg border border-gray-200 px-2 py-2 text-sm shadow-sm transition-all hover:border-gray-300 active:shadow-inner dark:border-gray-700 dark:hover:border-gray-500 absolute top-12 right-2 invisible opacity-0 group-hover:visible group-hover:opacity-100 dark:text-gray-700 text-gray-200"
			value={code}
		/>
	{/if}
</div>
