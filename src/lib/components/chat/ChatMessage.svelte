<script lang="ts">
	import { marked } from 'marked';
	import type { Message } from '$lib/types/Message';
	import { afterUpdate } from 'svelte';
	import { browser } from '$app/environment';

	import CopyToClipBoardBtn from '../CopyToClipBoardBtn.svelte';

	export let message: Message;
	let html = '';
	let el: HTMLElement;

	const renderer = new marked.Renderer();

	// Add wrapper to code blocks
	renderer.code = (code, lang) => {
		return `
			<div class="group code-block">
				<pre>
					<code class="language-${lang}">${code}</code>
				</pre>
			</div>
		`.replaceAll('\t', '');
	};

	const handleParsed = (err: Error | null, parsedHtml: string) => {
		if (err) {
			console.error(err);
		} else {
			html = parsedHtml;
		}
	};

	const options: marked.MarkedOptions = {
		...marked.getDefaults(),
		gfm: true,
		highlight: (code, lang, callback) => {
			import('highlight.js').then(
				({ default: hljs }) => {
					const language = hljs.getLanguage(lang);
					callback?.(null, hljs.highlightAuto(code, language?.aliases).value);
				},
				(err) => {
					console.error(err);
					callback?.(err);
				}
			);
		},
		renderer
	};

	$: browser && marked(message.content, options, handleParsed);

	html = marked(message.content, options);

	afterUpdate(() => {
		if (el) {
			const codeBlocks = el.querySelectorAll('.code-block');

			// Add copy to clipboard button to each code block
			codeBlocks.forEach((block) => {
				if (block.classList.contains('has-copy-btn')) return;

				new CopyToClipBoardBtn({
					target: block,
					props: {
						value: (block as HTMLElement).innerText ?? '',
						classNames:
							'absolute top-2 right-2 invisible opacity-0 group-hover:visible group-hover:opacity-100'
					}
				});
				block.classList.add('has-copy-btn');
			});
		}
	});
</script>

{#if message.from === 'assistant'}
	<div class="flex items-start justify-start gap-4 leading-relaxed">
		<img
			alt=""
			src="https://huggingface.co/avatars/2edb18bd0206c16b433841a47f53fa8e.svg"
			class="mt-5 w-3 h-3 flex-none rounded-full shadow-lg"
		/>
		<div
			class="relative rounded-2xl px-5 py-3.5 border border-gray-100 bg-gradient-to-br from-gray-50 dark:from-gray-800/40 dark:border-gray-800 prose text-gray-600 dark:text-gray-300"
			bind:this={el}
		>
			{@html html}
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
