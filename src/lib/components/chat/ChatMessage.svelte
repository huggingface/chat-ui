<script lang="ts">
	import type { Message } from '$lib/types/Message';

	export let message: Message;
</script>

{#if message.from === 'assistant'}
	<div class="flex items-start justify-start gap-4 leading-relaxed">
		<img
			alt=""
			src="https://huggingface.co/avatars/2edb18bd0206c16b433841a47f53fa8e.svg"
			class="mt-5 w-3 h-3 flex-none rounded-full shadow-lg"
		/>
		<div
			class="group relative rounded-2xl px-5 py-3.5 border border-gray-100 bg-gradient-to-br from-gray-50 dark:from-gray-800/40 dark:border-gray-800"
		>
			{message.content}
		</div>
	</div>
{/if}
{#if message.from === 'user'}
	<div class="flex items-start justify-start gap-4">
		<div class="mt-5 w-3 h-3 flex-none rounded-full" />
		<div class="rounded-2xl px-5 py-3.5 text-gray-500 dark:text-gray-400">
			{message.content}
		</div>
	</div>
{/if}
