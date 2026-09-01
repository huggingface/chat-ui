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
	const shortLabels: Record<HfHubResourceType, string> = {
		model: "M",
		dataset: "D",
		space: "S",
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
	class="absolute right-2 bottom-full left-2 z-30 mb-2 scrollbar-custom max-h-80 overflow-y-auto rounded-xl border border-gray-200 bg-white/95 py-1.5 text-sm text-gray-800 shadow-xl backdrop-blur-sm dark:border-gray-700/70 dark:bg-gray-800/95 dark:text-gray-100"
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
					class="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-gray-500 uppercase first:pt-1 dark:text-gray-400"
				>
					{labels[type]}
				</div>
				{#each group as result (result.id)}
					{@const resultIndex = results.indexOf(result)}
					<button
						id={`hf-hub-mention-option-${resultIndex}`}
						data-result-index={resultIndex}
						type="button"
						role="option"
						aria-selected={resultIndex === activeIndex}
						class={[
							"flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-100 focus:outline-hidden dark:hover:bg-white/10",
							resultIndex === activeIndex && "bg-gray-100 dark:bg-white/10",
						]}
						onpointerdown={(event) => event.preventDefault()}
						onmouseenter={() => onactivechange(resultIndex)}
						onclick={() => onselect(result)}
					>
						<span
							class="grid size-6 shrink-0 place-items-center rounded-md bg-gray-100 text-[10px] font-bold text-gray-500 dark:bg-white/10 dark:text-gray-300"
							aria-hidden="true"
						>
							{result.emoji ?? shortLabels[type]}
						</span>
						<span class="min-w-0 truncate font-medium">{result.id}</span>
					</button>
				{/each}
			{/if}
		{/each}
	{/if}
</div>
