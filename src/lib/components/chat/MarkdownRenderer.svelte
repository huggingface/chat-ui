<script lang="ts">
	import type { WebSearchSource } from "$lib/types/WebSearch";
	import { getMarked } from "$lib/utils/getMarked";
	import MarkdownWorker from "$lib/workers/markdownWorker?worker";

	interface Props {
		content: string;
		sources?: WebSearchSource[];
	}

	let { content, sources = [] }: Props = $props();

	let processedContent = $state([]);

	function processContent(content: string, sources: WebSearchSource[]) {
		if (typeof Worker !== "undefined") {
			const worker = new MarkdownWorker();
			worker.postMessage({ content, sources });
			worker.onmessage = (event) => {
				content = event.data.content;
			};
		} else {
			processedContent = getMarked(sources).parse(content);
		}
	}
</script>

{#each processedContent as token}
	{#if token.type === "text"}
		{@html token.html}
	{:else if token.type === "code"}
		<CodeBlock lang={token.lang} code={token.code} />
	{/if}
{/each}
