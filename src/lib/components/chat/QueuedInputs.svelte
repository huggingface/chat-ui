<script lang="ts">
	import type { QueuedChip } from "$lib/stores/queuedInputs.svelte";
	import CarbonClose from "~icons/carbon/close";
	import CarbonEdit from "~icons/carbon/edit";

	interface Props {
		items: QueuedChip[];
		busy: boolean;
		onremove: (id: string) => void;
		onedit: (id: string) => void;
	}

	let { items, busy, onremove, onedit }: Props = $props();
</script>

{#if items.length}
	<div class="queued-inputs mb-2 flex w-full max-w-4xl flex-col gap-1.5" aria-live="polite">
		<div class="px-1 text-xs text-gray-400 dark:text-gray-500">
			{busy
				? "Queued: ML Intern reads these at its next step"
				: "Queued: starting the next turn with these"}
		</div>
		{#each items as item (item.id)}
			<div
				class="flex items-start gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
				class:opacity-60={item.sending}
			>
				<p class="line-clamp-3 min-w-0 flex-1 wrap-break-word whitespace-break-spaces">
					{item.text}
				</p>
				{#if !item.sending}
					<button
						type="button"
						class="flex-none rounded p-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-100"
						aria-label="Edit queued message"
						title="Edit"
						onclick={() => onedit(item.id)}
					>
						<CarbonEdit class="size-3.5" />
					</button>
					<button
						type="button"
						class="flex-none rounded p-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-100"
						aria-label="Remove queued message"
						title="Remove"
						onclick={() => onremove(item.id)}
					>
						<CarbonClose class="size-3.5" />
					</button>
				{/if}
			</div>
		{/each}
	</div>
{/if}
