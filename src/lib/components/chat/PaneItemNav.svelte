<script lang="ts">
	import { sidePane } from "$lib/stores/sidePane.svelte";
	import { findPaneItemIndex, type PaneItem } from "$lib/utils/paneItems";

	import CarbonChevronLeft from "~icons/carbon/chevron-left";
	import CarbonChevronRight from "~icons/carbon/chevron-right";

	interface Props {
		/** Everything this conversation can show in the pane, in order. */
		items: PaneItem[];
	}

	let { items }: Props = $props();

	/**
	 * Moves the pane across everything the conversation produced — artifacts,
	 * dashboards, anything added later. Rendered by every view's header so the
	 * control sits in the same place whatever is showing; artifact versions stay
	 * on their own axis in the artifact footer.
	 *
	 * Hidden when there is nothing to move between, so a conversation with a
	 * single artifact looks exactly as it did before.
	 */
	let index = $derived(
		findPaneItemIndex(items, {
			view: sidePane.view,
			identifier: sidePane.identifier,
			trackioUrl: sidePane.trackio?.url,
		})
	);

	function goto(n: number) {
		const item = items[n];
		if (!item) return;
		if (item.kind === "artifact") sidePane.openArtifact(item.identifier, null);
		else sidePane.openTrackio(item.url, item.label);
	}

	// Names the destination rather than the direction: "Previous" says nothing the
	// arrow doesn't, and the label is how you tell two training runs apart.
	let prevLabel = $derived(index > 0 ? items[index - 1].label : undefined);
	let nextLabel = $derived(
		index >= 0 && index < items.length - 1 ? items[index + 1].label : undefined
	);
</script>

{#if items.length > 1}
	<div class="flex flex-none items-center gap-0.5 text-gray-400 dark:text-gray-500">
		<button
			type="button"
			class="btn rounded-sm p-0.5 hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-gray-800 dark:hover:text-gray-300"
			disabled={index <= 0}
			title={prevLabel ? `Previous: ${prevLabel}` : "Previous"}
			onclick={() => goto(index - 1)}
		>
			<CarbonChevronLeft class="text-xs" />
		</button>
		<span class="font-mono text-xxs tabular-nums">
			{index < 0 ? "–" : index + 1}/{items.length}
		</span>
		<button
			type="button"
			class="btn rounded-sm p-0.5 hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-gray-800 dark:hover:text-gray-300"
			disabled={index < 0 || index >= items.length - 1}
			title={nextLabel ? `Next: ${nextLabel}` : "Next"}
			onclick={() => goto(index + 1)}
		>
			<CarbonChevronRight class="text-xs" />
		</button>
	</div>
{/if}
