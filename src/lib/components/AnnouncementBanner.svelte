<script lang="ts">
	interface Props {
		title?: string;
		classNames?: string;
		children?: import("svelte").Snippet;
	}

	let { title = "", classNames = "", children }: Props = $props();
</script>

<div class="flex items-center rounded-xl bg-gray-100 p-1 text-sm dark:bg-gray-800 {classNames}">
	<span
		class="from-primary-300 text-primary-700 dark:from-primary-900 dark:text-primary-400 mr-2 inline-flex items-center rounded-lg bg-gradient-to-br px-2 py-1 text-xxs font-medium uppercase leading-3"
		>New</span
	>
	{title}
	<div class="ml-auto shrink-0">
		{@render children?.()}
	</div>
</div>
