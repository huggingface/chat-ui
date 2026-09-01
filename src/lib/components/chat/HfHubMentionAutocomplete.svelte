<script lang="ts">
	import type { HfHubResource, HfHubResourceType } from "$lib/utils/hfHubSearch";

	interface Props {
		results: HfHubResource[];
		status: "loading" | "success" | "error";
		activeIndex: number;
		onselect: (result: HfHubResource) => void;
		onactivechange: (index: number) => void;
	}

	let { results, status, activeIndex, onselect, onactivechange }: Props = $props();
	let listboxElement: HTMLDivElement | undefined = $state();

	const resourceTypes: HfHubResourceType[] = ["model", "dataset", "space"];
	const labels: Record<HfHubResourceType, string> = {
		model: "Models",
		dataset: "Datasets",
		space: "Spaces",
	};
	const headerClasses: Record<HfHubResourceType, string> = {
		model: "bg-blue-100 text-blue-950 dark:bg-blue-900 dark:text-blue-50",
		dataset: "bg-red-100 text-red-950 dark:bg-red-900 dark:text-red-50",
		space: "bg-orange-100 text-orange-950 dark:bg-orange-900 dark:text-orange-50",
	};

	$effect(() => {
		void activeIndex;
		listboxElement
			?.querySelector<HTMLElement>(`[data-result-index="${activeIndex}"]`)
			?.scrollIntoView({ block: "nearest" });
	});
</script>

<div
	bind:this={listboxElement}
	id="hf-hub-mention-listbox"
	role="listbox"
	aria-label="Hugging Face Hub suggestions"
	class="absolute right-2 bottom-full left-2 z-30 mb-2 scrollbar-custom max-h-80 overflow-y-auto rounded-xl border border-gray-200 bg-white text-sm text-gray-900 shadow-xl dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
>
	{#if status === "loading"}
		<div class="px-3 py-2 text-gray-500 dark:text-gray-400" role="status">
			Searching the Hugging Face Hub…
		</div>
	{:else if status === "error"}
		<div class="px-3 py-2 text-gray-500 dark:text-gray-400" role="status">
			Couldn’t search the Hugging Face Hub
		</div>
	{:else if results.length === 0}
		<div class="px-3 py-2 text-gray-500 dark:text-gray-400" role="status">
			No matching models, datasets, or Spaces
		</div>
	{:else}
		{#each resourceTypes as type}
			{@const group = results.filter((result) => result.type === type)}
			{#if group.length > 0}
				<div
					data-resource-header={type}
					class={[
						"border-t border-gray-200 px-4 py-2 text-sm font-semibold first:border-t-0 dark:border-gray-800",
						headerClasses[type],
					]}
				>
					{labels[type]}
				</div>
				{#each group as result (result.id)}
					{@const resultIndex = results.indexOf(result)}
					<button
						id={`hf-hub-mention-option-${resultIndex}`}
						data-result-index={resultIndex}
						data-resource-type={result.type}
						type="button"
						role="option"
						aria-selected={resultIndex === activeIndex}
						class={[
							"flex min-h-11 w-full items-center gap-2 border-t border-gray-200 px-4 py-2.5 text-left font-mono text-[15px] tracking-tight focus:outline-hidden dark:border-gray-800",
							resultIndex === activeIndex
								? "bg-blue-600 text-white dark:bg-blue-600"
								: "hover:bg-blue-50 dark:hover:bg-gray-900",
						]}
						onpointerdown={(event) => event.preventDefault()}
						onmouseenter={() => onactivechange(resultIndex)}
						onclick={() => onselect(result)}
					>
						{#if result.type === "space" && result.emoji}
							<span
								class="hf-hub-space-emoji w-5 shrink-0 text-base leading-none"
								aria-hidden="true"
							>
								{result.emoji}
							</span>
						{/if}
						<span class="min-w-0 truncate">{result.id}</span>
					</button>
				{/each}
			{/if}
		{/each}
	{/if}
</div>
