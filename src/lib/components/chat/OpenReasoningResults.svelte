<script lang="ts">
	import MarkdownRenderer from "./MarkdownRenderer.svelte";

	interface Props {
		content: string;
		loading?: boolean;
		hasNext?: boolean;
	}

	let { content, loading = false, hasNext = false }: Props = $props();
	let isOpen = $state(false);
	let wasLoading = $state(false);
	let initialized = $state(false);

	// Track loading transitions to auto-expand/collapse
	$effect(() => {
		// Auto-expand on first render if already loading
		if (!initialized) {
			initialized = true;
			if (loading) {
				isOpen = true;
				wasLoading = true;
				return;
			}
		}

		if (loading && !wasLoading) {
			// Loading started - auto-expand
			isOpen = true;
		} else if (!loading && wasLoading) {
			// Loading finished - auto-collapse
			isOpen = false;
		}
		wasLoading = loading;
	});

	void hasNext;
</script>

<button
	type="button"
	class="group/text w-full cursor-pointer text-left"
	onclick={() => (isOpen = !isOpen)}
>
	{#if isOpen}
		<div
			class="prose prose-sm max-w-none text-sm leading-relaxed text-gray-500 dark:prose-invert dark:text-gray-400"
		>
			<MarkdownRenderer {content} {loading} />
		</div>
	{:else}
		<div
			class="line-clamp-2 text-sm leading-relaxed text-gray-500 dark:text-gray-400"
			class:animate-pulse={loading}
		>
			{content
				.replace(/[#*_`~[\]]/g, "")
				.replace(/\n+/g, " ")
				.trim()}
		</div>
	{/if}
</button>
