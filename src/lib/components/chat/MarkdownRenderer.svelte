<script lang="ts">
	import { processBlocks, processBlocksSync, type BlockToken } from "$lib/utils/marked";
	import MarkdownWorker from "$lib/workers/markdownWorker?worker";
	import MarkdownBlock from "./MarkdownBlock.svelte";
	import { browser } from "$app/environment";

	import { onMount, onDestroy } from "svelte";
	import { updateDebouncer } from "$lib/utils/updates";

	interface Props {
		content: string;
		sources?: { title?: string; link: string }[];
		loading?: boolean;
	}

	let { content, sources = [], loading = false }: Props = $props();

	// Sync-computed blocks used as fallback and for SSR (where effects don't run)
	let syncBlocks = $derived(processBlocksSync(content, sources));
	let workerBlocks: BlockToken[] | null = $state(null);
	let blocks = $derived(workerBlocks ?? syncBlocks);

	let worker: Worker | null = null;
	let latestRequestId = 0;

	function handleBlocks(result: BlockToken[], requestId: number) {
		if (requestId !== latestRequestId) return;
		workerBlocks = result;
		updateDebouncer.endRender();
	}

	$effect(() => {
		if (!browser) return;

		const requestId = ++latestRequestId;

		if (worker) {
			updateDebouncer.startRender();
			worker.postMessage({ type: "process", content, sources, requestId });
			return;
		}

		(async () => {
			updateDebouncer.startRender();
			const processed = await processBlocks(content, sources);
			handleBlocks(processed, requestId);
		})();
	});

	onMount(() => {
		if (typeof Worker !== "undefined") {
			worker = new MarkdownWorker();
			worker.onmessage = (event: MessageEvent) => {
				const data = event.data as { type?: string; blocks?: BlockToken[]; requestId?: number };
				if (data?.type !== "processed" || !data.blocks || data.requestId === undefined) return;
				handleBlocks(data.blocks, data.requestId);
			};
		}
	});

	onDestroy(() => {
		worker?.terminate();
		worker = null;
	});
</script>

{#each blocks as block, index (loading && index === blocks.length - 1 ? `stream-${index}` : block.id)}
	<MarkdownBlock tokens={block.tokens} {loading} />
{/each}
