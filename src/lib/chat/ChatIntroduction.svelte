<script lang="ts">
	import { PUBLIC_DISABLE_INTRO_TILES, PUBLIC_MODEL_NAME, PUBLIC_MODEL_TAGLINE } from '$env/static/public';
	
	export let title: string = '';
</script>

<div class="grid grid-cols-3 gap-3 my-auto">
	<div class="col-span-3 text-center mb-10">
		<h1 class="text-3xl font-bold mb-1.5">{PUBLIC_MODEL_NAME || title}</h1>
		<p class="text-lg text-gray-500">
			{#if PUBLIC_MODEL_TAGLINE}
				{@html PUBLIC_MODEL_TAGLINE}
			{:else}
				Lorem ipsum dolor sit.
			{/if}
		</p>
	</div>
	{#if PUBLIC_DISABLE_INTRO_TILES !== "true"}
		<div class="bg-gray-50 dark:bg-gray-700 rounded-xl text-gray-500 dark:text-gray-400 p-4">
			Create
		</div>
		<div class="bg-gray-50 dark:bg-gray-700 rounded-xl text-gray-500 dark:text-gray-400 p-4">
			Discover
		</div>
		<div class="bg-gray-50 dark:bg-gray-700 rounded-xl text-gray-500 dark:text-gray-400 p-4">
			Overcome
		</div>
		<div class="bg-gray-50 dark:bg-gray-700 rounded-xl text-gray-500 dark:text-gray-400 p-4">
			Create
		</div>
		<div class="bg-gray-50 dark:bg-gray-700 rounded-xl text-gray-500 dark:text-gray-400 p-4">
			Discover
		</div>
		<div class="bg-gray-50 dark:bg-gray-700 rounded-xl text-gray-500 dark:text-gray-400 p-4">
			Overcome
		</div>
	{/if}
</div>
