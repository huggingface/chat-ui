<script lang="ts">
	import { createEventDispatcher } from "svelte";
	import { page } from "$app/stores";
	import type { MessageFile } from "$lib/types/Message";
	import CarbonClose from "~icons/carbon/close";
	import CarbonDocument from "~icons/carbon/document";

	export let file: MessageFile;
	export let canClose = true;
	const dispatch = createEventDispatcher<{ close: void }>();
</script>

<div
	class="group relative flex items-center rounded-xl shadow-lg"
	class:w-24={file.mime.startsWith("image/")}
	class:w-64={!file.mime.startsWith("image/")}
>
	{#if file.mime.startsWith("image/")}
		<div class="h-24 w-24 overflow-hidden rounded-xl">
			<img
				src={file.type === "base64"
					? `data:${file.mime};base64,${file.value}`
					: $page.url.pathname + "/output/" + file.value}
				alt={file.name}
				class="h-full w-full bg-gray-200 object-cover dark:bg-gray-800"
			/>
		</div>
	{:else}
		<div
			class="flex h-16 w-64 items-center gap-2 overflow-hidden rounded-xl bg-gray-200 p-2 dark:bg-gray-800"
		>
			<CarbonDocument class="h-12 w-12 rounded-lg p-2 dark:bg-blue-600" />
			<div class="flex flex-col">
				<div class="text-md max-w-72 truncate px-2 text-gray-800 dark:text-gray-200">
					{file.name}
				</div>
				<div class="px-2 text-sm text-gray-800 dark:text-gray-200">
					{file.mime.split("/")[1].toUpperCase()}
				</div>
			</div>
		</div>
	{/if}
	<!-- add a button on top that removes the image -->
	{#if canClose}
		<button
			class="invisible absolute -right-2 -top-2 rounded-full bg-gray-300 p-1 group-hover:visible dark:bg-gray-700"
			on:click={() => dispatch("close")}
		>
			<CarbonClose class="text-md font-black text-gray-300  hover:text-gray-100" />
		</button>
	{/if}
</div>
