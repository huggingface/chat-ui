<script lang="ts">
	import type { WebSearchUpdate } from "$lib/types/MessageUpdate";
	import CarbonError from "~icons/carbon/error-filled";

	import EosIconsLoading from "~icons/eos-icons/loading";

	export let loading = false;
	export let classNames = "";
	export let webSearchMessages: WebSearchUpdate[] = [];

	$: sources = webSearchMessages.find((m) => m.sources)?.sources;
	$: error = webSearchMessages.find((m) => m.messageType === "error");
</script>

<details
	class="flex w-fit rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900 {classNames} max-w-full"
>
	<summary class="grid min-w-72 select-none grid-cols-[40px,1fr] items-center gap-2.5 p-2">
		<div
			class="relative grid aspect-square place-content-center overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800"
		>
			<svg
				class="absolute inset-0 text-gray-300 transition-opacity dark:text-gray-700 {!sources &&
				!error
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
			<svg
				xmlns="http://www.w3.org/2000/svg"
				width="1em"
				height="1em"
				class="relative fill-current text-xl"
				viewBox="0 0 20 20"
			>
				><path
					fill-rule="evenodd"
					d="M1.5 10a8.5 8.5 0 1 0 17 0a8.5 8.5 0 0 0-17 0m16 0a7.5 7.5 0 1 1-15 0a7.5 7.5 0 0 1 15 0"
					clip-rule="evenodd"
				/><path
					fill-rule="evenodd"
					d="M6.5 10c0 4.396 1.442 8 3.5 8s3.5-3.604 3.5-8s-1.442-8-3.5-8s-3.5 3.604-3.5 8m6 0c0 3.889-1.245 7-2.5 7s-2.5-3.111-2.5-7S8.745 3 10 3s2.5 3.111 2.5 7"
					clip-rule="evenodd"
				/><path
					d="m3.735 5.312l.67-.742c.107.096.221.19.343.281c1.318.988 3.398 1.59 5.665 1.59c1.933 0 3.737-.437 5.055-1.19a5.59 5.59 0 0 0 .857-.597l.65.76c-.298.255-.636.49-1.01.704c-1.477.845-3.452 1.323-5.552 1.323c-2.47 0-4.762-.663-6.265-1.79a5.81 5.81 0 0 1-.413-.34m0 9.389l.67.74c.107-.096.221-.19.343-.28c1.318-.988 3.398-1.59 5.665-1.59c1.933 0 3.737.436 5.055 1.19c.321.184.608.384.857.596l.65-.76a6.583 6.583 0 0 0-1.01-.704c-1.477-.844-3.452-1.322-5.552-1.322c-2.47 0-4.762.663-6.265 1.789c-.146.11-.284.223-.413.34M2 10.5v-1h16v1z"
				/></svg
			>
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
	details[open] .content {
		animation-name: grow;
		animation-duration: 300ms;
		animation-delay: 0ms;
	}

	details summary::-webkit-details-marker {
		display: none;
	}

	@keyframes grow {
		0% {
			font-size: 0;
			opacity: 0;
		}
		30% {
			font-size: 1em;
			opacity: 0;
		}
		100% {
			opacity: 1;
		}
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
