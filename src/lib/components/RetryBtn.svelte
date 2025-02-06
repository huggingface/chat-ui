<script lang="ts">
	import CarbonRotate360 from "~icons/carbon/rotate-360";

	interface Props {
		classNames?: string;
		onClick?: () => void;
	}

	let { classNames = "", onClick }: Props = $props();
</script>

<button
	type="button"
	onclick={onClick}
	class="btn flex h-8 rounded-lg border bg-white px-3 py-1 text-gray-500 shadow-sm transition-all hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 {classNames}"
>
	<CarbonRotate360 class="mr-2 text-xs " /> Retry
</button>
