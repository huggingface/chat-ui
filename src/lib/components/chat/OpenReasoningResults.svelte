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
		class="group/header flex w-fit cursor-pointer select-none items-center gap-1 text-left focus:outline-none"
		onclick={() => (isOpen = !isOpen)}
		aria-label={isOpen ? "Collapse" : "Expand"}
	>
		<span
			class="text-sm font-medium transition-colors group-hover/header:text-gray-600 dark:group-hover/header:text-gray-300 {isOpen
				? 'text-gray-600 dark:text-gray-300'
				: 'text-gray-500 dark:text-gray-400'}"
			class:router-shimmer={loading}
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
		<div
			class="prose prose-sm mt-2 max-w-none text-sm leading-relaxed text-gray-500 dark:prose-invert dark:text-gray-400"
		>
			<MarkdownRenderer {content} {loading} />
		</div>
	{/if}
</BlockWrapper>
