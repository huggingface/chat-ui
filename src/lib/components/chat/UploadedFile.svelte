<script lang="ts">
	import { createEventDispatcher } from "svelte";
	import type { MessageFile } from "$lib/types/Message";
	import CarbonClose from "~icons/carbon/close";
	import CarbonDocument from "~icons/carbon/document";

	export let src: MessageFile & { name: string };
	const dispatch = createEventDispatcher<{ close: void }>();
</script>

<div
	class="group relative rounded-lg shadow-lg"
	class:w-24={src.mime.startsWith("image/")}
	class:w-64={!src.mime.startsWith("image/")}
>
	{#if src.mime.startsWith("image/")}
		<div class="h-24 w-24 overflow-hidden rounded-lg">
			<img
				src={`data:${src.mime};base64,${src.value}`}
				alt="input content"
				class="h-full w-full bg-gray-400 object-cover dark:bg-gray-700"
			/>
		</div>
	{:else}
		<div class="flex h-16 w-64 items-center gap-2 rounded-lg bg-gray-400 p-2 dark:bg-gray-700">
			<CarbonDocument class="h-12 w-12 rounded-lg p-2 dark:bg-blue-600" />
			<div class="flex flex-col">
				<div class="text-md px-2 text-gray-800 dark:text-gray-200">
					{src.name}
				</div>
				<div class="px-2 text-sm text-gray-800 dark:text-gray-200">
					{src.mime.split("/")[1].toUpperCase()}
				</div>
			</div>
		</div>
	{/if}
	<!-- add a button on top that deletes this image from sources -->
	<button
		class="invisible absolute -right-2 -top-2 rounded-full bg-gray-300 p-1 group-hover:visible dark:bg-gray-700"
		on:click={() => dispatch.close()}
	>
		<CarbonClose class="text-md font-black text-gray-300  hover:text-gray-100" />
	</button>
</div>
