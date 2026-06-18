<script lang="ts">
	import { page } from "$app/state";
</script>

<div
	class="flex items-center justify-center bg-linear-to-t from-gray-200 text-gray-800 dark:from-gray-700 dark:text-gray-300"
>
	<div
		class="align-center -mt-24 flex flex-col justify-center rounded-xl border bg-white px-8 pt-4 pb-2 text-center dark:border-gray-700 dark:bg-gray-800"
	>
		<h1 class="mb-2 text-5xl font-semibold">{page.status}</h1>
		<div class="-mx-8 my-2 h-px bg-gray-200 dark:bg-gray-700"></div>
		<h2 class="max-w-sm text-lg">{page.error?.message}</h2>
		{#if page.error?.errorId}
			<div class="-mx-8 my-2 h-px bg-gray-200 dark:bg-gray-700"></div>
			<pre class="max-w-sm text-left font-mono text-xs whitespace-pre-wrap">{page.error
					.errorId}</pre>
		{/if}
	</div>
</div>
