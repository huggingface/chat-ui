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
			<IconThought class="text-lg {loading ? 'animate-spin-slow' : ''}" />
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

	:global(.animate-spin-slow) {
		animation: spin 3s linear infinite;
	}

	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}
</style>
