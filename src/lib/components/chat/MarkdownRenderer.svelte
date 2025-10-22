<script lang="ts">
	import { processBlocks, processBlocksSync, type BlockToken } from "$lib/utils/marked";
	// import MarkdownWorker from "$lib/workers/markdownWorker?worker";
	import MarkdownBlock from "./MarkdownBlock.svelte";
	import { browser } from "$app/environment";

	import DOMPurify from "isomorphic-dompurify";
	import { onMount } from "svelte";
	import { updateDebouncer } from "$lib/utils/updates";

	interface Props {
		content: string;
		sources?: { title?: string; link: string }[];
		loading?: boolean;
	}

	let { content, sources = [], loading = false }: Props = $props();

	let blocks: BlockToken[] = $state(processBlocksSync(content, sources));

	async function processContent(
		content: string,
		sources: { title?: string; link: string }[]
	): Promise<BlockToken[]> {
		// Note: Worker support for blocks can be added later if needed
		// For now, use direct processing which is still efficient due to block memoization
		return processBlocks(content, sources);
	}

	$effect(() => {
		if (!browser) {
			blocks = processBlocksSync(content, sources);
		} else {
			(async () => {
				updateDebouncer.startRender();
				blocks = await processContent(content, sources).then(async (processedBlocks) =>
					Promise.all(
						processedBlocks.map(async (block) => ({
							...block,
							tokens: await Promise.all(
								block.tokens.map(async (token) => {
									if (token.type === "text") {
										token.html = DOMPurify.sanitize(await token.html);
									}
									return token;
								})
							),
						}))
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

{#each blocks as block, index (loading && index === blocks.length - 1 ? `stream-${index}` : block.id)}
	<MarkdownBlock tokens={block.tokens} {loading} />
{/each}
