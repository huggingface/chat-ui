<script lang="ts">
	import {
		MessageReasoningUpdateType,
		type MessageReasoningUpdate,
	} from "$lib/types/MessageUpdate";

	import IconThought from "~icons/carbon/circle-packing";
	import MarkdownRenderer from "./MarkdownRenderer.svelte";

	export let updates: MessageReasoningUpdate[];
	export let loading: boolean = false;

	$: summaries = updates
		.filter((u) => u.subtype === MessageReasoningUpdateType.Status)
		.map((u) => u.status);

	$: content = updates
		.filter((u) => u.subtype === MessageReasoningUpdateType.Stream)
		.reduce((acc, u) => acc + u.token, "");

	$: lastSummary = summaries[summaries.length - 1] || "";
</script>

<details
	class="u flex w-fit max-w-full rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900"
>
	<summary
		class="grid min-w-72 cursor-pointer select-none grid-cols-[40px,1fr] items-center gap-2.5 p-2"
	>
		<div
			class="relative grid aspect-square place-content-center overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800"
		>
			<IconThought class="text-lg {loading ? 'animate-spin' : ''}" />
		</div>
		<dl class="leading-4">
			<dd class="text-sm">Reasoning</dd>
			<dt
				class="flex items-center gap-1 truncate whitespace-nowrap text-[.82rem] text-gray-400"
				class:animate-pulse={loading}
			>
				{lastSummary}
			</dt>
		</dl>
	</summary>

	<div
		class="border-t border-gray-200 px-5 pb-2 pt-2 text-sm text-gray-600 dark:border-gray-800 dark:text-gray-400"
	>
		<MarkdownRenderer {content} />
	</div>
</details>

<style>
	details summary::-webkit-details-marker {
		display: none;
	}
</style>
