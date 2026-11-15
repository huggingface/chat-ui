<script lang="ts">
	import type { MessageHarnessEventUpdate } from "$lib/types/MessageUpdate";
	import { mlRegistry } from "$lib/stores/mlRegistry.svelte";
	import { sidePane } from "$lib/stores/sidePane.svelte";
	import { harnessEventLabel, stageBadge, type StageTone } from "$lib/utils/mlRegistry";

	interface Props {
		update: MessageHarnessEventUpdate;
	}

	let { update }: Props = $props();

	// only a conversation the registry is bound to has a pane to open, a share has none
	let canOpen = $derived(mlRegistry.conversationId !== undefined);

	const DOT: Record<StageTone, string> = {
		running: "bg-orange-500",
		queued: "bg-gray-400",
		completed: "bg-green-500",
		error: "bg-red-500",
		cancelled: "bg-gray-400",
		unknown: "bg-gray-400",
	};
</script>

{#snippet label(tone: StageTone, text: string)}
	<span class="size-1.5 flex-none rounded-full {DOT[tone]}" aria-hidden="true"></span>
	{text}
{/snippet}

<div class="harness-events flex flex-wrap gap-1.5">
	{#each update.events as event (event.serviceId)}
		{@const tone = stageBadge(event.to).tone}
		{#if canOpen}
			<button
				type="button"
				class="harness-event inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-800 dark:border-gray-700 dark:text-gray-300 dark:hover:border-gray-600 dark:hover:text-gray-100"
				data-tone={tone}
				title="Open the services list"
				onclick={() => sidePane.openRegistry()}
			>
				{@render label(tone, harnessEventLabel(event))}
			</button>
		{:else}
			<span
				class="harness-event inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400"
				data-tone={tone}
			>
				{@render label(tone, harnessEventLabel(event))}
			</span>
		{/if}
	{/each}
</div>
