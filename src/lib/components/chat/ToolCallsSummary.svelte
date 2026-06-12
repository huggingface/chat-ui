<script lang="ts">
	import type { MessageToolUpdate } from "$lib/types/MessageUpdate";
	import CarbonChevronRight from "~icons/carbon/chevron-right";
	import OpenReasoningResults from "./OpenReasoningResults.svelte";
	import ToolUpdate from "./ToolUpdate.svelte";

	type ProcessBlock =
		| { type: "think"; content: string; closed: boolean }
		| { type: "tool"; uuid: string; updates: MessageToolUpdate[] };

	interface Props {
		blocks: ProcessBlock[];
		toolCount: number;
	}

	let { blocks, toolCount }: Props = $props();
	let isOpen = $state(false);

	let label = $derived(
		toolCount > 0 ? `Called ${toolCount} tool${toolCount === 1 ? "" : "s"}` : "Thought"
	);
</script>

<div class="flex max-w-full select-none flex-col items-start">
	<!-- Summary header — aligns with the normal answer block -->
	<button
		type="button"
		class="group/header flex max-w-full cursor-pointer items-center gap-1 whitespace-nowrap text-left focus:outline-none"
		onclick={() => (isOpen = !isOpen)}
		aria-label={isOpen ? "Collapse" : "Expand"}
	>
		<span
			class="shrink-0 text-sm font-medium transition-colors group-hover/header:text-gray-600 dark:group-hover/header:text-gray-300 {isOpen
				? 'text-gray-600 dark:text-gray-300'
				: 'text-gray-500 dark:text-gray-400'}"
		>
			{label}
		</span>
		<CarbonChevronRight
			class="size-3.5 shrink-0 transition-all duration-200 group-hover/header:text-gray-600 dark:group-hover/header:text-gray-300 {isOpen
				? 'rotate-90 text-gray-600 dark:text-gray-300'
				: 'text-gray-400'}"
		/>
	</button>

	<!-- Child rows — aligned flush with the summary header -->
	{#if isOpen}
		<div class="mt-1 w-full">
			{#each blocks as block, i (block.type === "tool" ? `tool-${block.uuid}-${i}` : `think-${i}`)}
				{#if block.type === "think"}
					<OpenReasoningResults content={block.content} loading={false} />
				{:else}
					<ToolUpdate tool={block.updates} loading={false} />
				{/if}
			{/each}
		</div>
	{/if}
</div>
