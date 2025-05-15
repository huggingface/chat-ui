<script lang="ts">
	import type { WebSearchSource } from "$lib/types/WebSearch";
	import { processTokens, processTokensSync, type Token } from "$lib/utils/marked";
	// import MarkdownWorker from "$lib/workers/markdownWorker?worker";
	import CodeBlock from "../CodeBlock.svelte";
	import type { IncomingMessage, OutgoingMessage } from "$lib/workers/markdownWorker";
	import { browser } from "$app/environment";

	import DOMPurify from "isomorphic-dompurify";
	import { onMount } from "svelte";
	import { updateDebouncer } from "$lib/utils/updates";

	interface Props {
		content: string;
		sources?: WebSearchSource[];
	}

	let worker: Worker | null = null;

	let { content, sources = [] }: Props = $props();

	let tokens: Token[] = $state(processTokensSync(content, sources));

	async function processContent(content: string, sources: WebSearchSource[]): Promise<Token[]> {
		if (worker) {
			return new Promise((resolve) => {
				if (!worker) {
					throw new Error("Worker not initialized");
				}
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
				updateDebouncer.startRender();
				tokens = await processContent(content, sources).then(
					async (tokens) =>
						await Promise.all(
							tokens.map(async (token) => {
								if (token.type === "text") {
									token.html = DOMPurify.sanitize(await token.html);
								}
								return token;
							})
						)
				);

				updateDebouncer.endRender();
			})();
		}
	});

	onMount(() => {
		// todo: fix worker, seems to be transmitting a lot of data
		// worker = browser && window.Worker ? new MarkdownWorker() : null;

		DOMPurify.addHook("afterSanitizeAttributes", (node) => {
			if (node.tagName === "A") {
				node.setAttribute("target", "_blank");
				node.setAttribute("rel", "noreferrer");
			}
		});
	});
</script>

{#each tokens as token}
	{#if token.type === "text"}
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		{@html token.html}
	{:else if token.type === "code"}
		<CodeBlock code={token.code} rawCode={token.rawCode} />
	{/if}
{/each}
