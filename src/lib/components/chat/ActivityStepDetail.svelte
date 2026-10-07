<script lang="ts">
	import type { MessageToolUpdate } from "$lib/types/MessageUpdate";
	import MarkdownRenderer from "./MarkdownRenderer.svelte";
	import ToolUpdate from "./ToolUpdate.svelte";

	type ProcessBlock =
		| { type: "think"; content: string; closed: boolean; round?: number }
		| { type: "tool"; uuid: string; updates: MessageToolUpdate[]; round?: number };

	interface Props {
		block: ProcessBlock;
		loading?: boolean;
	}

	let { block, loading = false }: Props = $props();
</script>

<!-- What one step holds once opened: the raw reasoning, or the real call with its input and output. -->
{#if block.type === "think"}
	<div
		class="prose prose-sm scrollbar-custom max-h-80 max-w-none overflow-y-auto text-sm leading-relaxed text-gray-500 dark:text-gray-400 dark:prose-invert"
	>
		<MarkdownRenderer content={block.content} loading={false} />
	</div>
{:else}
	<ToolUpdate tool={block.updates} {loading} detailsOnly />
{/if}
