<script lang="ts">
	import { marked } from 'marked';
	import type { Message } from '$lib/types/Message';

	import CodeBlock from '../CodeBlock.svelte';
	import IconLoading from '../icons/IconLoading.svelte';

	function sanitizeMd(md: string) {
		return md.replaceAll('<', '&lt;');
	}

	export let message: Message;

	let el: HTMLElement;

	const options: marked.MarkedOptions = {
		...marked.getDefaults(),
		gfm: true
	};

	$: tokens = marked.lexer(sanitizeMd(message.content));
</script>

{#if message.from === 'assistant'}
	<div class="flex items-start justify-start gap-4 leading-relaxed">
		<img
			alt=""
			src="https://huggingface.co/avatars/2edb18bd0206c16b433841a47f53fa8e.svg"
			class="mt-5 w-3 h-3 flex-none rounded-full shadow-lg"
		/>
		<div
			class="relative rounded-2xl px-5 py-3.5 border border-gray-100 bg-gradient-to-br from-gray-50 dark:from-gray-800/40 dark:border-gray-800 text-gray-600 dark:text-gray-300 min-h-[calc(2rem+theme(spacing[3.5])*2)] min-w-[100px]"
			bind:this={el}
		>
			{#if !message.content}
				<IconLoading classNames="absolute inset-0 m-auto" />
			{/if}
			{#each tokens as token}
				{#if token.type === 'code'}
					<CodeBlock lang={token.lang} code={token.text} />
				{:else}
					<div class="prose dark:prose-invert :prose-pre:bg-gray-100 dark:prose-pre:bg-gray-950">
						{@html marked.parser([token], options)}
					</div>
				{/if}
			{/each}
		</div>
	</div>
{/if}
{#if message.from === 'user'}
	<div class="flex items-start justify-start gap-4">
		<div class="mt-5 w-3 h-3 flex-none rounded-full" />
		<div class="rounded-2xl px-5 py-3.5 text-gray-500 dark:text-gray-400 whitespace-break-spaces">
			{message.content.trim()}
		</div>
	</div>
{/if}
