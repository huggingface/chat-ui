<script lang="ts">
	import MarkdownRenderer from "./MarkdownRenderer.svelte";
	import CarbonCaretDown from "~icons/carbon/caret-down";

	export let summary: string;
	export let content: string;
	export let loading: boolean = false;
</script>

<details
	class="group flex w-fit max-w-full flex-col rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900"
>
	<summary
		class="
		grid min-w-72 cursor-pointer select-none grid-cols-[40px,1fr,24px] items-center gap-2.5 rounded-xl p-2 group-open:rounded-b-none hover:bg-gray-500/10"
	>
		<div
			class="relative grid aspect-square place-content-center overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800"
		>
			<div class="grid h-dvh place-items-center">
				<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 32 32">
					<path
						class="stroke-gray-600 dark:stroke-gray-400"
						style="stroke-width: 1.9; fill: none; stroke-linecap: round; stroke-linejoin: round;"
						d="M16 6v3.33M16 6c0-2.65 3.25-4.3 5.4-2.62 1.2.95 1.6 2.65.95 4.04a3.63 3.63 0 0 1 4.61.16 3.45 3.45 0 0 1 .46 4.37 5.32 5.32 0 0 1 1.87 4.75c-.22 1.66-1.39 3.6-3.07 4.14M16 6c0-2.65-3.25-4.3-5.4-2.62a3.37 3.37 0 0 0-.95 4.04 3.65 3.65 0 0 0-4.6.16 3.37 3.37 0 0 0-.49 4.27 5.57 5.57 0 0 0-1.85 4.85 5.3 5.3 0 0 0 3.07 4.15M16 9.33v17.34m0-17.34c0 2.18 1.82 4 4 4m6.22 7.5c.67 1.3.56 2.91-.27 4.11a4.05 4.05 0 0 1-4.62 1.5c0 1.53-1.05 2.9-2.66 2.9A2.7 2.7 0 0 1 16 26.66m10.22-5.83a4.05 4.05 0 0 0-3.55-2.17m-16.9 2.18a4.05 4.05 0 0 0 .28 4.1c1 1.44 2.92 2.09 4.59 1.5 0 1.52 1.12 2.88 2.7 2.88A2.7 2.7 0 0 0 16 26.67M5.78 20.85a4.04 4.04 0 0 1 3.55-2.18"
					/>

					{#if loading}
						<path
							class="animate-pulse stroke-purple-700"
							style="stroke-width: 2; fill: none; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 50;"
							d="M16 6v3.33M16 6c0-2.65 3.25-4.3 5.4-2.62 1.2.95 1.6 2.65.95 4.04a3.63 3.63 0 0 1 4.61.16 3.45 3.45 0 0 1 .46 4.37 5.32 5.32 0 0 1 1.87 4.75c-.22 1.66-1.39 3.6-3.07 4.14M16 6c0-2.65-3.25-4.3-5.4-2.62a3.37 3.37 0 0 0-.95 4.04 3.65 3.65 0 0 0-4.6.16 3.37 3.37 0 0 0-.49 4.27 5.57 5.57 0 0 0-1.85 4.85 5.3 5.3 0 0 0 3.07 4.15M16 9.33v17.34m0-17.34c0 2.18 1.82 4 4 4m6.22 7.5c.67 1.3.56 2.91-.27 4.11a4.05 4.05 0 0 1-4.62 1.5c0 1.53-1.05 2.9-2.66 2.9A2.7 2.7 0 0 1 16 26.66m10.22-5.83a4.05 4.05 0 0 0-3.55-2.17m-16.9 2.18a4.05 4.05 0 0 0 .28 4.1c1 1.44 2.92 2.09 4.59 1.5 0 1.52 1.12 2.88 2.7 2.88A2.7 2.7 0 0 0 16 26.67M5.78 20.85a4.04 4.04 0 0 1 3.55-2.18"
						>
							<animate
								attributeName="stroke-dashoffset"
								values="0;500"
								dur="12s"
								repeatCount="indefinite"
							/>
						</path>
					{/if}
				</svg>
			</div>
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
		<CarbonCaretDown class="size-6 text-gray-400 transition-transform group-open:rotate-180" />
	</summary>

	<div
		class="space-y-4 border-t border-gray-200 px-5 pb-2 pt-2 text-sm text-gray-600 dark:border-gray-800 dark:text-gray-400"
	>
		<MarkdownRenderer {content} />
	</div>
</details>

<style>
	details summary::-webkit-details-marker {
		display: none;
	}
</style>
