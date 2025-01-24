<script lang="ts">
	import type { PageData } from "./$types";

	import { env as envPublic } from "$env/dynamic/public";
	import { isHuggingChat } from "$lib/utils/isHuggingChat";

	import { base } from "$app/paths";
	import { page } from "$app/stores";

	import CarbonHelpFilled from "~icons/carbon/help-filled";
	import CarbonTools from "~icons/carbon/tools";
	import CarbonImage from "~icons/carbon/image";
	import { useSettingsStore } from "$lib/stores/settings";
	export let data: PageData;

	const settings = useSettingsStore();
</script>

<svelte:head>
	{#if isHuggingChat}
		<title>HuggingChat - Models</title>
		<meta property="og:title" content="HuggingChat - Models" />
		<meta property="og:type" content="link" />
		<meta property="og:description" content="Browse HuggingChat available models" />
		<meta property="og:url" content={$page.url.href} />
	{/if}
</svelte:head>

<div class="scrollbar-custom h-full overflow-y-auto py-12 max-sm:pt-8 md:py-24">
	<div class="pt-42 mx-auto flex flex-col px-5 xl:w-[60rem] 2xl:w-[64rem]">
		<div class="flex items-center">
			<h1 class="text-2xl font-bold">Models</h1>
			{#if isHuggingChat}
				<a
					href="https://huggingface.co/spaces/huggingchat/chat-ui/discussions/372"
					class="ml-auto dark:text-gray-400 dark:hover:text-gray-300"
					target="_blank"
					aria-label="Hub discussion about models"
				>
					<CarbonHelpFilled />
				</a>
			{/if}
		</div>
		<h2 class="text-gray-500">All models available on {envPublic.PUBLIC_APP_NAME}</h2>
		<div class="mt-8 grid grid-cols-1 gap-3 sm:gap-5 xl:grid-cols-2">
			{#each data.models.filter((el) => !el.unlisted) as model, index (model.id)}
				<div
					aria-label="Model card"
					role="region"
					class="relative flex flex-col gap-2 overflow-hidden rounded-xl border bg-gray-50/50 px-6 py-5 shadow hover:bg-gray-50 hover:shadow-inner dark:border-gray-800/70 dark:bg-gray-950/20 dark:hover:bg-gray-950/40"
					class:active-model={model.id === $settings.activeModel}
				>
					<a
						href="{base}/models/{model.id}"
						class="absolute inset-0 z-10"
						aria-label="View details for {model.displayName}"
					/>
					<div class="flex items-center justify-between gap-1">
						{#if model.logoUrl}
							<img
								class="overflown aspect-square size-6 rounded border dark:border-gray-700"
								src={model.logoUrl}
								alt="{model.displayName} logo"
							/>
						{:else}
							<div
								class="size-6 rounded border border-transparent bg-gray-300 dark:bg-gray-800"
								aria-hidden="true"
							/>
						{/if}
						{#if model.tools}
							<span
								title="This model supports tools."
								class="ml-auto grid size-[21px] place-items-center rounded-lg border border-purple-300 dark:border-purple-700"
								aria-label="Model supports tools"
								role="img"
							>
								<CarbonTools class="text-xxs text-purple-700 dark:text-purple-500" />
							</span>
						{/if}
						{#if model.multimodal}
							<span
								title="This model is multimodal and supports image inputs natively."
								class="ml-auto flex size-[21px] items-center justify-center rounded-lg border border-blue-700 dark:border-blue-500"
								aria-label="Model is multimodal"
								role="img"
							>
								<CarbonImage class="text-xxs text-blue-700 dark:text-blue-500" />
							</span>
						{/if}
						{#if model.reasoning}
							<span
								title="This model supports reasoning."
								class="ml-auto grid size-[21px] place-items-center rounded-lg border border-purple-300 dark:border-purple-700"
								aria-label="Model supports reasoning"
								role="img"
							>
								<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 32 32">
									<path
										class="stroke-purple-700"
										style="stroke-width: 2; fill: none; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 50;"
										d="M16 6v3.33M16 6c0-2.65 3.25-4.3 5.4-2.62 1.2.95 1.6 2.65.95 4.04a3.63 3.63 0 0 1 4.61.16 3.45 3.45 0 0 1 .46 4.37 5.32 5.32 0 0 1 1.87 4.75c-.22 1.66-1.39 3.6-3.07 4.14M16 6c0-2.65-3.25-4.3-5.4-2.62a3.37 3.37 0 0 0-.95 4.04 3.65 3.65 0 0 0-4.6.16 3.37 3.37 0 0 0-.49 4.27 5.57 5.57 0 0 0-1.85 4.85 5.3 5.3 0 0 0 3.07 4.15M16 9.33v17.34m0-17.34c0 2.18 1.82 4 4 4m6.22 7.5c.67 1.3.56 2.91-.27 4.11a4.05 4.05 0 0 1-4.62 1.5c0 1.53-1.05 2.9-2.66 2.9A2.7 2.7 0 0 1 16 26.66m10.22-5.83a4.05 4.05 0 0 0-3.55-2.17m-16.9 2.18a4.05 4.05 0 0 0 .28 4.1c1 1.44 2.92 2.09 4.59 1.5 0 1.52 1.12 2.88 2.7 2.88A2.7 2.7 0 0 0 16 26.67M5.78 20.85a4.04 4.04 0 0 1 3.55-2.18"
									/>
								</svg>
							</span>
						{/if}
						{#if model.id === $settings.activeModel}
							<span
								class="rounded-full border border-blue-500 bg-blue-500/5 px-2 py-0.5 text-xs text-blue-500 dark:border-blue-500 dark:bg-blue-500/10"
							>
								Active
							</span>
						{:else if index === 0}
							<span
								class="rounded-full border border-gray-300 px-2 py-0.5 text-xs text-gray-500 dark:border-gray-500 dark:text-gray-400"
							>
								Default
							</span>
						{/if}
					</div>
					<span class="flex items-center gap-2 font-semibold">
						{model.displayName}
					</span>
					<span class="whitespace-pre-wrap text-sm text-gray-500 dark:text-gray-400">
						{model.description || "-"}
					</span>
				</div>
			{/each}
		</div>
	</div>
</div>

<style lang="postcss">
	.active-model {
		@apply border-blue-500 bg-blue-500/5 hover:bg-blue-500/10;
	}
</style>
