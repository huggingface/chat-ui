<script lang="ts">
	import { PUBLIC_DISABLE_INTRO_TILES, PUBLIC_MODEL_NAME } from '$env/static/public';

	import Logo from '$lib/components/icons/Logo.svelte';
</script>

<div class="grid lg:grid-cols-3 gap-8 my-auto">
	<div class="lg:col-span-1">
		<div>
			<div class="text-2xl font-bold mb-3 flex items-center">
				<Logo classNames="mr-2 text-yellow-400 text-3xl" />
				HuggingChat
			</div>
			<p class="text-lg text-gray-600 dark:text-gray-400">
				Making the best open AI chat models available to everyone.
			</p>
		</div>
	</div>
	<div class="lg:col-span-2 lg:pl-24">
		<div class="border dark:border-gray-800 rounded-xl overflow-hidden">
			<div class="p-3">
				<div class="text-sm text-gray-600 dark:text-gray-400">Current Model</div>
				<div class="font-semibold">{PUBLIC_MODEL_NAME}</div>
			</div>
			<div
				class="flex items-center gap-4 px-3 py-2 bg-gray-100 rounded-xl text-sm text-gray-600 dark:text-gray-300 dark:bg-gray-800"
			>
				<a href="https://huggingface.co/OpenAssistant/llama_30b_oasst_latcyr_1000" target="_blank"
					>Model page</a
				>
				<a href="https://huggingface.co/datasets/OpenAssistant/oasst1" target="_blank"
					>Dataset page</a
				>
				<a href="https://open-assistant.io/" target="_blank" class="ml-auto"
					>Open Assistant website</a
				>
			</div>
		</div>
	</div>
	{#if PUBLIC_DISABLE_INTRO_TILES}
		<div class="lg:col-span-3 lg:mt-12">
			<p class="mb-3 text-gray-600 dark:text-gray-300">Examples</p>
			<div class="grid lg:grid-cols-3 gap-3 lg:gap-5">
				<button
					class="text-gray-600 dark:text-gray-300 p-4 bg-gray-50 dark:bg-gray-800 dark:hover:bg-gray-700 hover:bg-gray-100 border dark:border-gray-800 rounded-xl"
					>"Write an email from bullet list"</button
				>
				<button
					class="text-gray-600 dark:text-gray-300 p-4 bg-gray-50 dark:bg-gray-800 dark:hover:bg-gray-700 hover:bg-gray-100 border dark:border-gray-800 rounded-xl"
					>"Code a snake game"</button
				>
				<button
					class="text-gray-600 dark:text-gray-300 p-4 bg-gray-50 dark:bg-gray-800 dark:hover:bg-gray-700 hover:bg-gray-100 border dark:border-gray-800 rounded-xl"
					>"Assist in a task"</button
				>
			</div>
		</div>
	{/if}
</div>
