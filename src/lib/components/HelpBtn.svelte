<script lang="ts">
	import CarbonHelp from "~icons/carbon/help";

	export let classNames = "";
	export let onclick = () => {
		console.log("Help button clicked");
	};
</script>

<button
	class="btn relative h-8 rounded-lg border bg-white px-3 py-1 text-sm text-gray-500 shadow-sm hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 {classNames}"
	on:click={onclick}
>
	<CarbonHelp class="mr-2 text-xxs" /> Help
</button>
