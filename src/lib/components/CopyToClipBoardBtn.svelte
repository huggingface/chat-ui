<script lang="ts">
	import { onDestroy, onMount } from 'svelte';

	import IconCopy from './icons/Copy.svelte';
	import Tooltip from './Tooltip.svelte';

	export let classNames = '';
	export let value: string;

	let isSuccess = false;
	let timeout: any;
	let el: HTMLElement;
	let clipboard: ClipboardJS;

	onMount(async () => {
		const { default: ClipboardJS } = await import('clipboard');

		clipboard = new ClipboardJS(el);

		clipboard.on('success', function () {
			isSuccess = true;
			if (timeout) {
				clearTimeout(timeout);
			}
			timeout = setTimeout(() => {
				isSuccess = false;
			}, 1000);
		});
	});

	onDestroy(() => {
		clipboard.destroy();

		if (timeout) {
			clearTimeout(timeout);
		}
	});
</script>

<button
	class="relative 'inline-flex cursor-pointer items-center text-sm focus:outline-none rounded-lg border py-1 px-2 shadow-sm' {classNames}
		{!isSuccess && 'text-gray-600'}
		{isSuccess && 'text-green-500'}
	"
	title={'Copy to clipboard'}
	type="button"
	bind:this={el}
	data-clipboard-text={value}
>
	<IconCopy />
	<Tooltip classNames={isSuccess ? 'opacity-100' : 'opacity-0'} />
</button>
