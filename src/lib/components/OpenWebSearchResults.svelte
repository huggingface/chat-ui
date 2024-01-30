<script lang="ts">
	import type { WebSearchUpdate } from "$lib/types/MessageUpdate";

	import CarbonError from "~icons/carbon/error-filled";
	import EosIconsLoading from "~icons/eos-icons/loading";
	import IconInternet from "./icons/IconInternet.svelte";

	export let classNames = "";
	export let webSearchMessages: WebSearchUpdate[] = [];

	$: sources = webSearchMessages.find((m) => m.sources)?.sources;
	$: error = webSearchMessages.find((m) => m.messageType === "error");
	$: loading = !sources && !error;
</script>

<details
	class="flex w-fit rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900 {classNames} max-w-full"
>
	<summary class="grid min-w-72 select-none grid-cols-[40px,1fr] items-center gap-2.5 p-2">
		<div
			class="relative grid aspect-square place-content-center overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800"
		>
			<svg
				class="absolute inset-0 text-gray-300 transition-opacity dark:text-gray-700 {loading
					? 'opacity-100'
					: 'opacity-0'}"
				width="40"
				height="40"
				viewBox="0 0 38 38"
				fill="none"
				xmlns="http://www.w3.org/2000/svg"
			>
				<path
					class="loading-path"
					d="M8 2.5H30C30 2.5 35.5 2.5 35.5 8V30C35.5 30 35.5 35.5 30 35.5H8C8 35.5 2.5 35.5 2.5 30V8C2.5 8 2.5 2.5 8 2.5Z"
					stroke="currentColor"
					stroke-width="1"
					stroke-linecap="round"
					id="shape"
				/>
			</svg>
			<IconInternet classNames="relative fill-current text-xl" />
		</div>
		<dl class="leading-4">
			<dd class="text-sm">Web Search</dd>
			<dt class="flex items-center gap-1 truncate whitespace-nowrap text-[.82rem] text-gray-400">
				{#if error}
					{error.message}
				{:else if sources}
					Completed
				{:else}
					{webSearchMessages[webSearchMessages.length - 1].message}
				{/if}
			</dt>
		</dl>
	</summary>

	<div class="content px-5 pb-5 pt-4">
		{#if webSearchMessages.length === 0}
			<div class="mx-auto w-fit">
				<EosIconsLoading class="mb-3 h-4 w-4" />
			</div>
		{:else}
			<ol>
				{#each webSearchMessages as message}
					{#if message.messageType === "update"}
						<li class="group border-l pb-6 last:!border-transparent last:pb-0 dark:border-gray-800">
							<div class="flex items-start">
								<div
									class="-ml-1.5 h-3 w-3 flex-none rounded-full bg-gray-200 dark:bg-gray-600 {loading
										? 'group-last:animate-pulse group-last:bg-gray-300 group-last:dark:bg-gray-500'
										: ''}"
								/>
								<h3 class="text-md -mt-1.5 pl-2.5 text-gray-800 dark:text-gray-100">
									{message.message}
								</h3>
							</div>
							{#if message.args}
								<p class="mt-1.5 pl-4 text-gray-500 dark:text-gray-400">
									{message.args}
								</p>
							{/if}
						</li>
					{:else if message.messageType === "error"}
						<li class="group border-l pb-6 last:!border-transparent last:pb-0 dark:border-gray-800">
							<div class="flex items-start">
								<CarbonError
									class="-ml-1.5 h-3 w-3 flex-none scale-110 text-red-700 dark:text-red-500"
								/>
								<h3 class="text-md -mt-1.5 pl-2.5 text-red-700 dark:text-red-500">
									{message.message}
								</h3>
							</div>
							{#if message.args}
								<p class="mt-1.5 pl-4 text-gray-500 dark:text-gray-400">
									{message.args}
								</p>
							{/if}
						</li>
					{/if}
				{/each}
			</ol>
		{/if}
	</div>
</details>

<style>
	details summary::-webkit-details-marker {
		display: none;
	}

	.loading-path {
		stroke-dasharray: 61.45;
		animation: loading 2s linear infinite;
	}

	@keyframes loading {
		to {
			stroke-dashoffset: 122.9;
		}
	}
</style>
