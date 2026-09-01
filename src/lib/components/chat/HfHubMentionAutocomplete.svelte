<script lang="ts">
	import type { HfHubResource, HfHubResourceType } from "$lib/utils/hfHubSearch";

	interface Props {
		results: HfHubResource[];
		status: "loading" | "success" | "error";
		activeIndex: number;
		/**
		 * Where the `@` sits, relative to the composer box. The panel is anchored
		 * to the mention rather than to the composer's edges, so it reads as an
		 * autocomplete for that word instead of a dropdown for the whole input.
		 */
		caretAnchor: { left: number; bottom: number };
		onselect: (result: HfHubResource) => void;
		onactivechange: (index: number) => void;
	}

	let { results, status, activeIndex, caretAnchor, onselect, onactivechange }: Props = $props();
	let listboxElement: HTMLDivElement | undefined = $state();

	const labels: Record<HfHubResourceType, string> = {
		model: "Models",
		dataset: "Datasets",
		space: "Spaces",
	};
	/**
	 * Group once, carrying each option's flat index with it. The template used to
	 * filter three times and recover the index with `indexOf` per row — O(n²) on
	 * every arrow key, and dependent on object identity, so it would break if the
	 * list were ever copied.
	 */
	let groups = $derived(
		(["model", "dataset", "space"] as HfHubResourceType[])
			.map((type) => ({
				type,
				options: results
					.map((result, index) => ({ result, index }))
					.filter((option) => option.result.type === type),
			}))
			.filter((group) => group.options.length > 0)
	);

	$effect(() => {
		void activeIndex;
		listboxElement
			?.querySelector<HTMLElement>(`[data-result-index="${activeIndex}"]`)
			?.scrollIntoView({ block: "nearest" });
	});
</script>

<!-- The live region is a sibling of the listbox, not a child: a listbox may only
     own options and groups, and a live region inserted at the same moment as its
     content is usually not announced at all. -->
<div class="sr-only" role="status" aria-live="polite">
	{#if status === "loading"}
		Searching the Hugging Face Hub
	{:else if status === "error"}
		Couldn’t search the Hugging Face Hub
	{:else if results.length === 0}
		No matching models, datasets, or Spaces
	{:else}
		{results.length} suggestions available
	{/if}
</div>

<div
	class="pointer-events-none absolute z-30"
	style="left: {caretAnchor.left}px; bottom: {caretAnchor.bottom}px;"
>
	<div
		bind:this={listboxElement}
		id="hf-hub-mention-listbox"
		role="listbox"
		aria-label="Hugging Face Hub suggestions"
		class="pointer-events-auto scrollbar-custom max-h-64 w-72 max-w-[min(20rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 text-[13px] shadow-lg dark:border-gray-700 dark:bg-gray-900"
	>
		{#if status === "loading"}
			<p class="px-2.5 py-1.5 text-gray-400 dark:text-gray-500">Searching…</p>
		{:else if status === "error"}
			<p class="px-2.5 py-1.5 text-gray-400 dark:text-gray-500">Hub search unavailable</p>
		{:else if results.length === 0}
			<p class="px-2.5 py-1.5 text-gray-400 dark:text-gray-500">No matches</p>
		{:else}
			{#each groups as group (group.type)}
				<!-- Kept per review: the type is what disambiguates two repos that share
				     a name. Quiet enough to read as a divider rather than a row. -->
				<div role="group" aria-label={labels[group.type]}>
					<div
						data-resource-header={group.type}
						class="px-2.5 pt-2 pb-1 text-[10px] font-medium tracking-wide text-gray-400 uppercase dark:text-gray-500"
					>
						{labels[group.type]}
					</div>
					{#each group.options as option (option.result.id)}
						<button
							id={`hf-hub-mention-option-${option.index}`}
							data-result-index={option.index}
							data-resource-type={option.result.type}
							type="button"
							role="option"
							aria-selected={option.index === activeIndex}
							class={[
								"flex w-full items-center gap-2 px-2.5 py-1 text-left focus:outline-hidden",
								option.index === activeIndex
									? "bg-gray-100 dark:bg-gray-800"
									: "hover:bg-gray-50 dark:hover:bg-gray-800/60",
							]}
							onpointerdown={(event) => event.preventDefault()}
							onmouseenter={() => onactivechange(option.index)}
							onclick={() => onselect(option.result)}
						>
							<!-- Only Spaces carry a mark, and only their own emoji: a generic
							     type glyph on every row just repeats the heading above it. The
							     slot is still reserved for an emoji-less Space so rows inside
							     the group stay aligned with each other. -->
							{#if option.result.type === "space"}
								<span
									class="hf-hub-space-emoji flex size-4 shrink-0 items-center justify-center text-[13px] leading-none"
									aria-hidden="true"
								>
									{option.result.emoji ?? ""}
								</span>
							{/if}
							<span class="min-w-0 truncate text-gray-800 dark:text-gray-200">
								{option.result.id}
							</span>
						</button>
					{/each}
				</div>
			{/each}
		{/if}
	</div>
</div>
