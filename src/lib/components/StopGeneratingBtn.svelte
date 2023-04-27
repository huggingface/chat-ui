<script lang="ts">
	import CarbonPause from "~icons/carbon/pause-filled";

	export let visible: boolean = false;
	export let className = "";
</script>

<button
	type="button"
	on:click
	class="btn absolute flex rounded-lg border bg-white px-3 py-1 shadow-sm transition-all hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:hover:bg-gray-600 
    {className}
    {visible ? 'visible opacity-100' : 'invisible opacity-0'}
    "
>
	<CarbonPause class="-ml-1 mr-1 h-[1.25rem] w-[1.1875rem] text-gray-400" /> Stop generating
</button>
