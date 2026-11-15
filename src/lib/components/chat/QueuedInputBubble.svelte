<script lang="ts">
	import type { MessageQueuedInputUpdate } from "$lib/types/MessageUpdate";
	import { splitSlackRequest } from "$lib/utils/slackRequest";

	interface Props {
		update: MessageQueuedInputUpdate;
		slackManaged?: boolean;
	}

	let { update, slackManaged = false }: Props = $props();
</script>

<div class="queued-input flex flex-col gap-1.5">
	{#each update.inputs as input (input.id)}
		<div
			class="rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2 dark:border-gray-700 dark:bg-gray-800/60"
		>
			<div class="mb-0.5 text-xs text-gray-400 dark:text-gray-500">You, while it worked</div>
			<p class="text-sm wrap-break-word whitespace-break-spaces text-gray-600 dark:text-gray-300">
				{slackManaged ? splitSlackRequest(input.text).request : input.text}
			</p>
		</div>
	{/each}
</div>
