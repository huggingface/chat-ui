<script lang="ts">
	import { page } from "$app/stores";
</script>

<div
	class="flex items-center justify-center bg-gradient-to-t from-gray-200 text-gray-800 dark:from-gray-700 dark:text-gray-300"
>
	<div
		class="align-center -mt-24 flex flex-col justify-center rounded-xl border bg-white px-8 pb-2 pt-4 text-center dark:border-gray-700 dark:bg-gray-800"
	>
		<h1 class="mb-2 text-5xl font-semibold">{$page.status}</h1>
		<div class="-mx-8 my-2 h-px bg-gray-200 dark:bg-gray-700" />
		<h2 class="max-w-sm text-lg">{$page.error?.message}</h2>
	</div>
</div>
