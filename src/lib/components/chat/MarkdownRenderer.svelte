<script lang="ts">
	import type { WebSearchSource } from "$lib/types/WebSearch";
	import { processTokens, processTokensSync, type Token } from "$lib/utils/marked";
	import MarkdownWorker from "$lib/workers/markdownWorker?worker";
	import CodeBlock from "../CodeBlock.svelte";
	import type { IncomingMessage, OutgoingMessage } from "$lib/workers/markdownWorker";
	import { browser } from "$app/environment";

	import DOMPurify from "isomorphic-dompurify";

	interface Props {
		content: string;
		sources?: WebSearchSource[];
	}

	const worker = browser && window.Worker ? new MarkdownWorker() : null;

	let { content, sources = [] }: Props = $props();

	let tokens: Token[] = $state(processTokensSync(content, sources));

	async function processContent(content: string, sources: WebSearchSource[]): Promise<Token[]> {
		if (worker) {
			return new Promise((resolve) => {
				worker.onmessage = (event: MessageEvent<OutgoingMessage>) => {
					if (event.data.type !== "processed") {
						throw new Error("Invalid message type");
					}
					resolve(event.data.tokens);
				};
				worker.postMessage(
					JSON.parse(JSON.stringify({ content, sources, type: "process" })) as IncomingMessage
				);
			});
		} else {
			return processTokens(content, sources);
		}
	}

	$effect(() => {
		if (!browser) {
			tokens = processTokensSync(content, sources);
		} else {
			(async () => {
				tokens = await processContent(content, sources);
			})();
		}
	});

	DOMPurify.addHook("afterSanitizeAttributes", (node) => {
		if (node.tagName === "A") {
			node.setAttribute("target", "_blank");
			node.setAttribute("rel", "noreferrer");
		}
	});
</script>

{#each tokens as token}
	{#if token.type === "text"}
		{#await token.html then html}
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			{@html DOMPurify.sanitize(html)}
		{/await}
	{:else if token.type === "code"}
		<CodeBlock lang={token.lang} code={token.code} />
	{/if}
{/each}
