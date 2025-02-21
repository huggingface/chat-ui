<script lang="ts">
	import type { Message } from "$lib/types/Message";
	import CarbonThumbsUp from "~icons/carbon/thumbs-up";
	import CarbonThumbsDown from "~icons/carbon/thumbs-down";

	import { createEventDispatcher } from "svelte";

	interface Props {
		message: Message;
	}

	let { message }: Props = $props();

	const dispatch = createEventDispatcher<{
		vote: { score: Message["score"]; id: Message["id"] };
	}>();
</script>

<button
	class="btn rounded-sm p-1 text-sm text-gray-400 hover:text-gray-500 focus:ring-0 dark:text-gray-400 dark:hover:text-gray-300
{message.score && message.score > 0
		? 'text-green-500 hover:text-green-500 dark:text-green-400 hover:dark:text-green-400'
		: ''}"
	title={message.score === 1 ? "Remove +1" : "+1"}
	type="button"
	onclick={() => dispatch("vote", { score: message.score === 1 ? 0 : 1, id: message.id })}
>
	<CarbonThumbsUp class="h-[1.14em] w-[1.14em]" />
</button>
<button
	class="btn rounded-sm p-1 text-sm text-gray-400 hover:text-gray-500 focus:ring-0 dark:text-gray-400 dark:hover:text-gray-300
{message.score && message.score < 0
		? 'text-red-500 hover:text-red-500 dark:text-red-400 hover:dark:text-red-400'
		: ''}"
	title={message.score === -1 ? "Remove -1" : "-1"}
	type="button"
	onclick={() => dispatch("vote", { score: message.score === -1 ? 0 : -1, id: message.id })}
>
	<CarbonThumbsDown class="h-[1.14em] w-[1.14em]" />
</button>
