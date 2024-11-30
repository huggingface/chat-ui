<script lang="ts">
	import IconThought from "~icons/carbon/circle-packing";
	import MarkdownRenderer from "./MarkdownRenderer.svelte";

	export let summary: string;
	export let content: string;
	export let loading: boolean = false;
</script>

<details
	class="u flex w-fit max-w-full rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900"
>
	<summary
		class="grid min-w-72 cursor-pointer select-none grid-cols-[40px,1fr] items-center gap-2.5 p-2"
	>
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

			<IconThought class="text-[1rem]" />
		</div>
		<dl class="leading-4">
			<dd class="text-sm">Reasoning</dd>
			<dt
				class="flex items-center gap-1 truncate whitespace-nowrap text-[.82rem] text-gray-400"
				class:animate-pulse={loading}
			>
				{summary}
			</dt>
		</dl>
	</summary>

	<div
		class="border-t border-gray-200 px-5 pb-2 pt-2 text-sm text-gray-600 dark:border-gray-800 dark:text-gray-400"
	>
		<MarkdownRenderer {content} />
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
