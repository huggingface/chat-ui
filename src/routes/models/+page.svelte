<script lang="ts">
	import type { PageData } from "./$types";
	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";

	import { base } from "$app/paths";
	import { page } from "$app/state";

	import CarbonHelpFilled from "~icons/carbon/help-filled";
	import CarbonView from "~icons/carbon/view";
	import CarbonSettings from "~icons/carbon/settings";
	import { useSettingsStore } from "$lib/stores/settings";
	import { goto } from "$app/navigation";
	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	const settings = useSettingsStore();

	const publicConfig = usePublicConfig();

	// Local filter state for model search (hyphen/space insensitive)
	let modelFilter = $state("");
	const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ");
	let queryTokens = $derived(normalize(modelFilter).trim().split(/\s+/).filter(Boolean));
</script>

<svelte:head>
	{#if publicConfig.isHuggingChat}
		<title>HuggingChat - Models</title>
		<meta property="og:title" content="HuggingChat - Models" />
		<meta property="og:type" content="link" />
		<meta property="og:description" content="Browse HuggingChat available models" />
		<meta property="og:url" content={page.url.href} />
	{/if}
</svelte:head>

<div class="scrollbar-custom h-full overflow-y-auto py-12 max-sm:pt-8 md:py-24">
	<div class="pt-42 mx-auto flex flex-col px-5 xl:w-[60rem] 2xl:w-[64rem]">
		<div class="flex items-center">
			<h1 class="text-2xl font-bold">Models</h1>
			{#if publicConfig.isHuggingChat}
				<a
					href="https://huggingface.co/docs/inference-providers"
					class="ml-auto text-gray-500 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-300"
					target="_blank"
					aria-label="Hub discussion about models"
				>
					<CarbonHelpFilled />
				</a>
			{/if}
		</div>
		<h2 class="text-gray-500">
			All models available{#if publicConfig.isHuggingChat}&nbsp;via <a
					target="_blank"
					href="https://huggingface.co/inference/models"
					class="underline decoration-gray-300 hover:decoration-gray-500 dark:decoration-gray-600 dark:hover:decoration-gray-500"
					>Inference Providers</a
				>{/if}
		</h2>

		<!-- Filter input -->
		<input
			type="search"
			bind:value={modelFilter}
			placeholder="Search by name"
			aria-label="Search models by name or id"
			class="mt-4 w-full rounded-3xl border border-gray-300 bg-white px-5 py-2 text-[15px]
				placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300
				dark:border-gray-700 dark:bg-gray-900 dark:focus:ring-gray-700"
		/>
		<div class="mt-6 grid grid-cols-1 gap-3 sm:gap-5 xl:grid-cols-2">
			{#each data.models
				.filter((el) => !el.unlisted)
				.filter((el) => {
					const haystack = normalize(`${el.id} ${el.name ?? ""} ${el.displayName ?? ""}`);
					return queryTokens.every((q) => haystack.includes(q));
				}) as model, index (model.id)}
				<a
					href="{base}/models/{model.id}"
					aria-label="Model card"
					class="relative flex flex-col gap-2 overflow-hidden rounded-xl border bg-gray-50/50 px-6 py-5 shadow hover:bg-gray-50 hover:shadow-inner dark:border-gray-800/70 dark:bg-gray-950/20 dark:hover:bg-gray-950/40"
					class:active-model={model.id === $settings.activeModel}
				>
					<div class="flex items-center justify-between gap-1">
						{#if model.logoUrl}
							<img
								class="aspect-square size-6 rounded border bg-white dark:border-gray-700"
								src={model.logoUrl}
								alt=""
							/>
						{:else}
							<div
								class="size-6 rounded border border-transparent bg-gray-300 dark:bg-gray-800"
								aria-hidden="true"
							></div>
						{/if}
						<div class="flex items-center gap-1">
							{#if $settings.multimodalOverrides?.[model.id] ?? model.multimodal}
								<span
									title="This model is multimodal and supports image inputs natively."
									class="ml-auto flex size-[21px] items-center justify-center rounded-lg border border-blue-700 dark:border-blue-500"
									aria-label="Model is multimodal"
									role="img"
								>
									<CarbonView class="text-xxs text-blue-700 dark:text-blue-500" />
								</span>
							{/if}
							<button
								type="button"
								title="Model settings"
								aria-label="Model settings for {model.displayName}"
								class="flex size-[21px] items-center justify-center rounded-md border border-gray-300 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
								onclick={(e) => {
									e.preventDefault();
									e.stopPropagation();
									goto(`${base}/settings/${model.id}`);
								}}
							>
								<CarbonSettings class="text-xs" />
							</button>
							{#if model.id === $settings.activeModel}
								<span
									class="rounded-full bg-black px-2 py-0.5 text-xs text-white dark:bg-white dark:text-black"
								>
									Active
								</span>
							{:else if index === 0 && model.id === "omni"}
								<span
									class="rounded-full border border-gray-300 px-2 py-0.5 text-xs text-gray-500 dark:border-gray-500 dark:text-gray-400"
								>
									Default
								</span>
							{/if}
						</div>
					</div>
					<span class="flex items-center gap-2 font-semibold">
						{model.displayName}
					</span>
					<span class="line-clamp-4 whitespace-pre-wrap text-sm text-gray-500 dark:text-gray-400">
						{model.description || "-"}
					</span>
				</a>
			{/each}
		</div>
	</div>
</div>
