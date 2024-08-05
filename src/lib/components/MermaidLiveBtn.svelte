<!-- MermaidLiveBtn.svelte -->
<script lang="ts">
    import { deflate } from 'pako';
    import CarbonLaunch from "~icons/carbon/launch";
	import IconInternet from "./icons/IconInternet.svelte";
    export let classNames = "";
    export let value: string;

    function serializeToPako(graphMarkdown: string): string {
        const jGraph = { code: graphMarkdown, mermaid: { theme: "default" } };
        const jsonString = JSON.stringify(jGraph);
        const byteArray = new TextEncoder().encode(jsonString);
        const compressed = deflate(byteArray, { level: 9 });
        
        return window.btoa(String.fromCharCode.apply(null, Array.from(compressed)))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
    }

    function generateMermaidLiveLink(code: string): string {
        const pakoString = serializeToPako(code);
        return `https://mermaid.live/edit#pako:${pakoString}`;
    }

    function handleClick() {
        const link = generateMermaidLiveLink(value);
        window.open(link, '_blank');
    }
</script>

<button
    class="btn rounded-lg border border-gray-200 px-2 py-2 text-sm shadow-sm transition-all hover:border-gray-300 active:shadow-inner dark:border-gray-700 dark:hover:border-gray-500 {classNames}"
    title="Edit on Mermaid Live"
    type="button"
    on:click={handleClick}
>
    <div class="relative">
        <slot>
            <IconInternet classNames="dark:text-gray-700 text-gray-200" />
        </slot>
    </div>
</button>