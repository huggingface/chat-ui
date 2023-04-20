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
	class="btn text-sm rounded-lg border py-2 px-2 shadow-sm text-gray-800 border-gray-200 active:shadow-inner dark:text-gray-200 dark:border-gray-800 {classNames}
		{!isSuccess && 'text-gray-600'}
		{isSuccess && 'text-green-500'}
	"
	title={'Copy to clipboard'}
	type="button"
	bind:this={el}
	data-clipboard-text={value}
>
	<span class="relative">
		<IconCopy />
		<Tooltip classNames={isSuccess ? 'opacity-100' : 'opacity-0'} />
	</span>
</button>
