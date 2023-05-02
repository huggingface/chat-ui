<script lang="ts">
	import { createEventDispatcher, onDestroy } from "svelte";
	import CarbonExport from "~icons/carbon/export";
	import CarbonLink from "~icons/carbon/link";

	import Tooltip from "../Tooltip.svelte";

	const dispatch = createEventDispatcher<{
		share: void;
	}>();

	let isSuccess = false;
	let timeout: any;

	const handleClick = async () => {
		dispatch("share");

		// writeText() can be unavailable or fail in some cases (iframe, etc) so we try/catch
		try {
			await navigator.clipboard.writeText("value");

			isSuccess = true;
			if (timeout) {
				clearTimeout(timeout);
			}
			timeout = setTimeout(() => {
				isSuccess = false;
			}, 100000);
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

<div class="relative">
	<button
		class="flex flex-none items-center hover:text-gray-400 hover:underline max-sm:rounded-lg max-sm:bg-gray-50 max-sm:px-2.5 dark:max-sm:bg-gray-800"
		type="button"
		on:click={handleClick}
	>
		<CarbonExport class="text-[.6rem] sm:mr-1.5 sm:text-yellow-500" />
		<div class="max-sm:hidden">Share this conversation</div>
	</button>
	<Tooltip
		classNames="w-[13em] flex items-center {isSuccess ? 'opacity-100' : 'opacity-0'}"
		position="left-1/2 bottom-full transform -translate-x-1/2 translate-y-2 mb-3"
		arrowPosition="top-full left-1/2 -translate-x-1/2 rotate-180"
		><CarbonLink class="mr-2 shrink-0" /> Link created and Copied to clipboard!</Tooltip
	>
</div>
