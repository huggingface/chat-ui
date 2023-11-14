<script lang="ts">
	import CarbonRotate360 from "~icons/carbon/rotate-360";

	export let classNames = "";
</script>

<button
	type="button"
	on:click
	class="btn flex h-8 rounded-lg border bg-white px-3 py-1 text-gray-500 shadow-sm transition-all hover:bg-gray-100 {classNames}"
>
	<CarbonRotate360 class="mr-2 text-xs " /> Retry
</button>
