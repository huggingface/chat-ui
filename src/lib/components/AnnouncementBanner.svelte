<script lang="ts">
	export let title = "";
	export let classNames = "";
</script>

<div class="flex items-center rounded-xl bg-gray-100 p-1 text-sm dark:bg-gray-800 {classNames}">
	<span
		class="mr-2 inline-flex items-center rounded-lg bg-gradient-to-br from-yellow-300 px-2 py-1 text-xxs font-medium uppercase leading-3 text-yellow-700 dark:from-[#373010] dark:text-yellow-400"
		>New</span
	>
	{title}
	<div class="ml-auto shrink-0">
		<slot />
	</div>
</div>
