<script lang="ts">
	import MarkdownRenderer from "./MarkdownRenderer.svelte";
	import BlockWrapper from "./BlockWrapper.svelte";
	import CarbonChevronRight from "~icons/carbon/chevron-right";

	interface Props {
		content: string;
		loading?: boolean;
	}

	let { content, loading = false }: Props = $props();
	let isOpen = $state(false);
	let wasLoading = $state(false);
	let initialized = $state(false);

	// Track loading transitions to auto-expand/collapse
	$effect(() => {
		if (!initialized) {
			initialized = true;
			if (loading) {
				isOpen = true;
				wasLoading = true;
				return;
			}
		}

		if (loading && !wasLoading) {
			isOpen = true;
		} else if (!loading && wasLoading) {
			isOpen = false;
		}
		wasLoading = loading;
	});
</script>

<BlockWrapper>
	<!-- Header row -->
	<button
		type="button"
		class="group/header flex w-fit cursor-pointer items-center gap-1 text-left select-none focus:outline-hidden"
		onclick={() => (isOpen = !isOpen)}
		aria-label={isOpen ? "Collapse" : "Expand"}
	>
		<span
			class="text-sm font-medium transition-colors group-hover/header:text-gray-600 dark:group-hover/header:text-gray-300 {isOpen
				? 'text-gray-600 dark:text-gray-300'
				: 'text-gray-500 dark:text-gray-400'}"
			class:thinking-shimmer={loading}
		>
			Thinking
		</span>
		<CarbonChevronRight
			class="size-3.5 transition-all duration-200 group-hover/header:text-gray-600 dark:group-hover/header:text-gray-300 {isOpen
				? 'rotate-90 text-gray-600 dark:text-gray-300'
				: 'text-gray-400'}"
		/>
	</button>

	<!-- Expandable content -->
	{#if isOpen}
		{#if loading}
			<!--
				Streaming view: fixed-height viewport, content bottom-aligned so newly
				arriving tokens stay visible while older lines are clipped off the top.
				Works for any model output format (no parsing).
			-->
			<div
				class="thinking-viewport mt-2 flex max-h-56 flex-col justify-end overflow-hidden md:max-h-80"
			>
				<div
					class="prose prose-sm max-w-none text-sm leading-relaxed text-gray-500 *:first:mt-0 *:last:mb-0 dark:text-gray-400 dark:prose-invert"
				>
					<MarkdownRenderer {content} {loading} />
				</div>
			</div>
		{:else}
			<div
				class="prose prose-sm mt-2 max-w-none text-sm leading-relaxed text-gray-500 dark:text-gray-400 dark:prose-invert"
			>
				<MarkdownRenderer {content} {loading} />
			</div>
		{/if}
	{/if}
</BlockWrapper>

<style>
	/* Variant of router-shimmer (defined in main.css) — same opacity pulse,
	 * slightly darker resting color in light mode. */
	.thinking-shimmer {
		display: inline-block;
		color: rgb(107, 114, 128);
		animation: router-shimmer 2.8s ease-in-out infinite;
	}
	:global(.dark) .thinking-shimmer {
		color: rgba(255, 255, 255, 0.7);
	}
</style>
