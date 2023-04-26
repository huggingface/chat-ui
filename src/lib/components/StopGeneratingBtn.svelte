<script lang="ts">
	import CarbonPause from "~icons/carbon/pause-filled";

	export let visible: boolean = false;
	export let className = "";
</script>

<button
	type="button"
	on:click
	class="absolute btn flex rounded-lg border py-1 px-3 shadow-sm bg-white dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 dark:border-gray-600 transition-all 
    {className}
    {visible ? 'opacity-100 visible' : 'opacity-0 invisible'}
    "
>
	<CarbonPause class="mr-1 -ml-1 w-[1.1875rem] h-[1.25rem] text-gray-400" /> Stop generating
</button>
