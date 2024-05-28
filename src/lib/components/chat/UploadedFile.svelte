<script lang="ts">
	import { createEventDispatcher } from "svelte";
	import { page } from "$app/stores";
	import type { MessageFile } from "$lib/types/Message";
	import CarbonClose from "~icons/carbon/close";
	import CarbonDocumentBlank from "~icons/carbon/document-blank";

	export let file: MessageFile;
	export let canClose = true;
	const dispatch = createEventDispatcher<{ close: void }>();

	function truncateMiddle(text: string, maxLength: number): string {
		if (text.length <= maxLength) {
			return text;
		}

		const halfLength = Math.floor((maxLength - 1) / 2);
		const start = text.substring(0, halfLength);
		const end = text.substring(text.length - halfLength);

		return `${start}…${end}`;
	}
</script>

<div
	class="group relative flex items-center rounded-xl shadow-sm"
	class:w-24={file.mime.startsWith("image/")}
	class:w-72={!file.mime.startsWith("image/")}
>
	{#if file.mime.startsWith("image/")}
		<div class="size-24 overflow-hidden rounded-xl">
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
			class="flex h-14 w-72 items-center gap-2 overflow-hidden rounded-xl border border-gray-200 bg-white p-2 dark:border-gray-800 dark:bg-gray-900"
		>
			<div
				class="grid size-10 flex-none place-items-center rounded-lg bg-gray-100 dark:bg-gray-800"
			>
				<CarbonDocumentBlank class="text-base text-gray-700 dark:text-gray-300" />
			</div>
			<dl class="flex flex-col truncate leading-tight">
				<dd class="text-sm">
					{truncateMiddle(file.name, 28)}
				</dd>
				<dt class="text-xs text-gray-400">{file.mime.split("/")[1].toUpperCase()}</dt>
			</dl>
		</div>
	{/if}
	<!-- add a button on top that removes the image -->
	{#if canClose}
		<button
			class="invisible absolute -right-2 -top-2 grid size-6 place-items-center rounded-full border bg-black group-hover:visible dark:border-gray-700"
			on:click={() => dispatch("close")}
		>
			<CarbonClose class=" text-xs  text-white" />
		</button>
	{/if}
</div>
