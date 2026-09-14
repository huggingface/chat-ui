<script lang="ts">
	import CarbonContinue from "~icons/carbon/continue";

	interface Props {
		classNames?: string;
		onClick?: () => void;
	}

	let { classNames = "", onClick }: Props = $props();
</script>

<button
	type="button"
	onclick={onClick}
	title="Send a message asking the model to continue from where the failed turn left off"
	class="btn flex h-7 rounded-lg border bg-white px-2 py-1 text-sm text-gray-500 shadow-xs hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 {classNames}"
>
	<CarbonContinue class="mr-1 -translate-y-px text-[.65rem]" /> Resume
</button>
