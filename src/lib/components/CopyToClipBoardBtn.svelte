<script lang="ts">
	import { onDestroy } from 'svelte';

	import IconCopy from './icons/IconCopy.svelte';
	import Tooltip from './Tooltip.svelte';

	export let classNames = '';
	export let value: string;

	let isSuccess = false;
	let timeout: any;

	const handleClick = async () => {
		// writeText() can be unavailable or fail in some cases (iframe, etc) so we try/catch
		try {
			await navigator.clipboard.writeText(value);

			isSuccess = true;
			if (timeout) {
				clearTimeout(timeout);
			}
			timeout = setTimeout(() => {
				isSuccess = false;
			}, 1000);
		} catch (err) {
			console.error(err);
		}
	};

	onDestroy(() => {
		if (timeout) {
			clearTimeout(timeout);
		}
	});
</script>

<button
	class="btn text-sm rounded-lg border py-2 px-2 shadow-sm border-gray-200 active:shadow-inner dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-400 transition-all {classNames}
		{!isSuccess && 'text-gray-200 dark:text-gray-200'}
		{isSuccess && 'text-green-500'}
	"
	title={'Copy to clipboard'}
	type="button"
	on:click={handleClick}
>
	<span class="relative">
		<IconCopy />
		<Tooltip classNames={isSuccess ? 'opacity-100' : 'opacity-0'} />
	</span>
</button>
