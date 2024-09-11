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
			{#each data.models as model, index (model.id)}
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
