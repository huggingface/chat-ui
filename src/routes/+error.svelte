<script lang="ts">
	import { page } from "$app/stores";
</script>

<div
	class="flex items-center justify-center text-gray-800 dark:text-gray-300 bg-gradient-to-t from-gray-200 dark:from-gray-700"
>
	<div
		class="dark:bg-gray-800 bg-white border rounded-xl pb-2 pt-4 px-8 flex flex-col justify-center align-center text-center -mt-24 dark:border-gray-700"
	>
		<h1 class="text-5xl mb-2 font-semibold">{$page.status}</h1>
		<div class="h-px dark:bg-gray-700 bg-gray-200 -mx-8 my-2" />
		<h2 class="text-lg">{$page.error?.message}</h2>
	</div>
</div>
