<script lang="ts">
	export let title = "";
	export let classNames = "";
</script>

<div class="flex items-center rounded-xl bg-gray-100 p-1 text-sm {classNames}">
	<span
		class="mr-2 inline-flex items-center rounded-lg bg-gradient-to-br from-primary-300 px-2 py-1 text-xxs font-medium uppercase leading-3 text-primary-700"
		>New</span
	>
	{title}
	<div class="ml-auto shrink-0">
		<slot />
	</div>
</div>
