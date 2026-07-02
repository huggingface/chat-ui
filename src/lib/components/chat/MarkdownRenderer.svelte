<script lang="ts">
	import { fallbackBlocks, type BlockToken } from "$lib/utils/markedLight";
	import {
		acquireMarkdownClientId,
		cancelMarkdownClient,
		renderMarkdownBlocks,
	} from "$lib/utils/markdownWorkerPool";
	import MarkdownBlock from "./MarkdownBlock.svelte";
	import { browser } from "$app/environment";

	import { onDestroy } from "svelte";
	import { updateDebouncer } from "$lib/utils/updates";

	interface Props {
		content: string;
		sources?: { title?: string; link: string }[];
		loading?: boolean;
	}

	let { content, sources = [], loading = false }: Props = $props();

	// Lightweight blocks used for SSR and the initial client render. Full markdown
	// rendering is deferred to the shared worker pool (or async processBlocks fallback)
	// on the client, so the heavy synchronous pipeline never runs on the server event
	// loop. See fallbackBlocks.
	let fallback = $derived(fallbackBlocks(content));
	let workerBlocks: BlockToken[] | null = $state(null);
	let blocks = $derived(workerBlocks ?? fallback);

	// Stable id so the pool can coalesce this instance's successive (streaming) renders.
	const clientId = acquireMarkdownClientId();
	let latestRequestId = 0;

	function handleBlocks(result: BlockToken[], requestId: number) {
		if (requestId !== latestRequestId) return;
		workerBlocks = result;
		updateDebouncer.endRender();
	}

	$effect(() => {
		if (!browser) return;
		updateDebouncer.startRender();
		latestRequestId = renderMarkdownBlocks(clientId, content, sources, loading, handleBlocks);
	});

	onDestroy(() => {
		cancelMarkdownClient(clientId);
	});
</script>

{#each blocks as block, index (loading && index === blocks.length - 1 ? `stream-${index}` : block.id)}
	<MarkdownBlock tokens={block.tokens} {loading} />
{/each}
