<script lang="ts">
    import { onMount } from "svelte";
	import { afterUpdate } from "svelte";
    import CopyToClipBoardBtn from "./CopyToClipBoardBtn.svelte";
	import MermaidLiveBtn from "./MermaidLiveBtn.svelte";
    import DOMPurify from "isomorphic-dompurify";
    import mermaid from 'mermaid';
    import { default as hljs } from "highlight.js";

    export let code = "";
    export let lang = "";
    export let loading = false;

    let highlightedCode = "";
    let mermaidId = `mermaid-${Math.random().toString(36).slice(2, 9)}`;
    let renderPromise: Promise<{ svg: string; bindFunctions?: (element: Element) => void }> | null = null;

    onMount(() => {
        mermaid.initialize({ 
			startOnLoad: false, 
			securityLevel: "antiscript",
			theme: "dark"===localStorage.theme ? "dark" : "default" });
    });

    $: if (lang === 'mermaid' && !loading && code) {
        renderPromise = mermaid.render(mermaidId, code);
    } else {
        renderPromise = null;
    }

	afterUpdate(async () => {
		const language = hljs.getLanguage(lang);
		highlightedCode = hljs.highlightAuto(code, language?.aliases).value;
	});

</script>

<div class="group relative my-4 rounded-lg">
    {#if lang === 'mermaid' && !loading}
        {#await renderPromise}
<pre>{code}</pre>
        {:then result}
            {#if result?.svg}
{@html result.svg}
            {:else}
<pre>{  DOMPurify.sanitize(code) }</pre>
            {/if}
        {:catch error}
<pre>{DOMPurify.sanitize(code)}</pre>
            <p class="text-red-500">Error rendering diagram: {error.message}</p>
        {/await}
    {:else}
        <pre class="scrollbar-custom overflow-auto px-5 scrollbar-thumb-gray-500 hover:scrollbar-thumb-gray-400 dark:scrollbar-thumb-white/10 dark:hover:scrollbar-thumb-white/20">
<code class="language-{lang}">{@html DOMPurify.sanitize(highlightedCode)  || code.replaceAll("<", "&lt;") }</code>
        </pre>
    {/if}
    <CopyToClipBoardBtn
        classNames="absolute top-2 right-2 invisible opacity-0 group-hover:visible group-hover:opacity-100"
        value={code}
    />
    {#if lang === 'mermaid'}
        <MermaidLiveBtn
            classNames="absolute top-12 right-2 invisible opacity-0 group-hover:visible group-hover:opacity-100"
            value={code}
        />
    {/if}	
</div>