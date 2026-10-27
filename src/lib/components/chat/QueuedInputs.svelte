<script lang="ts">
	import type { QueuedChip } from "$lib/stores/queuedInputs.svelte";
	import { splitSlackRequest } from "$lib/utils/slackRequest";
	import CarbonClose from "~icons/carbon/close";
	import CarbonEdit from "~icons/carbon/edit";

	interface Props {
		items: QueuedChip[];
		busy: boolean;
		slackManaged?: boolean;
		onremove: (id: string) => void;
		onedit: (id: string) => void;
		onsendnow: () => Promise<void>;
	}

	let { items, busy, slackManaged = false, onremove, onedit, onsendnow }: Props = $props();

	let sending = $state(false);

	async function sendNow() {
		sending = true;
		try {
			await onsendnow();
		} finally {
			sending = false;
		}
	}
</script>

{#if items.length}
	<div class="queued-inputs mb-2 flex w-full max-w-4xl flex-col gap-1.5" aria-live="polite">
		<div class="flex items-center gap-2 px-1 text-xs text-gray-400 dark:text-gray-500">
			<span class="flex-1">
				{busy
					? "Queued: ML Intern reads these at its next step"
					: "Queued: starting the next turn with these"}
			</span>
			{#if busy && items.some((item) => !item.sending)}
				<button
					type="button"
					class="rounded-md px-1.5 py-0.5 font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white"
					title="Stop the current step and send these now"
					disabled={sending}
					onclick={sendNow}
				>
					Send now
				</button>
			{/if}
		</div>
		{#each items as item (item.id)}
			<div
				class="flex items-start gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
				class:opacity-60={item.sending}
			>
				<p class="line-clamp-3 min-w-0 flex-1 wrap-break-word whitespace-break-spaces">
					{slackManaged ? splitSlackRequest(item.text).request : item.text}
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
