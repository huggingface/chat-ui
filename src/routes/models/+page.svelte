<script lang="ts">
	import type { PageData } from "./$types";
	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";

	import { base } from "$app/paths";
	import { page } from "$app/state";

	import CarbonHelpFilled from "~icons/carbon/help-filled";
	import LucideHammer from "~icons/lucide/hammer";
	import LucideImage from "~icons/lucide/image";
	import LucideSettings from "~icons/lucide/settings";
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

	// Filtered models list
	let filteredModels = $derived(
		data.models
			.filter((el) => !el.unlisted)
			.filter((el) => {
				const haystack = normalize(`${el.id} ${el.name ?? ""} ${el.displayName ?? ""}`);
				return queryTokens.every((q) => haystack.includes(q));
			})
	);
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

<div
	class="scrollbar-custom h-full overflow-y-auto bg-gray-50 py-12 max-sm:pt-8 dark:bg-gray-950 md:py-24"
>
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

		<div class="mt-6 min-h-[50vh]">
			<div class="grid grid-cols-1 gap-6 p-1 md:grid-cols-2">
				{#each filteredModels as model, index (model.id)}
					{@const isActive = model.id === $settings.activeModel}
					<a
						href="{base}/models/{model.id}"
						aria-label="Model card for {model.displayName}"
						class="group relative rounded-3xl border p-6 shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-all duration-300
							{isActive
							? 'border-gray-900/10 bg-white shadow-lg ring-1 ring-black/5 dark:border-gray-700 dark:bg-gray-900 dark:ring-white/10'
							: 'border-transparent bg-white hover:-translate-y-1 hover:border-gray-200 hover:shadow-xl dark:bg-gray-900 dark:hover:border-gray-800'}"
					>
						<!-- Header: Avatar + Icons -->
						<div class="mb-4 flex items-start justify-between">
							<!-- Avatar -->
							<div class="relative">
								{#if model.logoUrl}
									<img
										alt={model.displayName}
										class="h-12 w-12 rounded-2xl border border-gray-100 bg-white object-cover shadow-sm dark:border-gray-800 dark:bg-gray-800"
										src={model.logoUrl}
									/>
								{:else}
									<div
										class="h-12 w-12 rounded-2xl border border-gray-100 bg-gray-200 shadow-sm dark:border-gray-800 dark:bg-gray-700"
										aria-hidden="true"
									></div>
								{/if}
							</div>

							<!-- Icons -->
							<div class="flex items-center gap-2">
								{#if $settings.toolsOverrides?.[model.id] ?? (model as { supportsTools?: boolean }).supportsTools}
									<div
										title="This model supports tool calling (functions)."
										class="flex h-8 w-8 items-center justify-center rounded-full bg-purple-50 text-purple-600 transition-colors dark:bg-purple-900/20 dark:text-purple-400"
									>
										<LucideHammer class="h-3.5 w-3.5" />
									</div>
								{/if}
								{#if $settings.multimodalOverrides?.[model.id] ?? model.multimodal}
									<div
										title="This model is multimodal and supports image inputs natively."
										class="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-blue-600 transition-colors dark:bg-blue-900/20 dark:text-blue-400"
									>
										<LucideImage class="h-3.5 w-3.5" />
									</div>
								{/if}
								<button
									type="button"
									title="Model settings"
									aria-label="Model settings for {model.displayName}"
									class="flex h-8 w-8 items-center justify-center rounded-full bg-gray-50 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:bg-gray-800 dark:hover:bg-gray-700 dark:hover:text-gray-200"
									onclick={(e) => {
										e.preventDefault();
										e.stopPropagation();
										goto(`${base}/settings/${model.id}`);
									}}
								>
									<LucideSettings class="h-3.5 w-3.5" />
								</button>
								{#if isActive}
									<span
										class="ml-2 rounded-full bg-black px-2.5 py-1 text-xs font-bold text-white shadow-lg dark:bg-white dark:text-black"
									>
										Active
									</span>
								{/if}
							</div>
						</div>

						<!-- Content -->
						<div>
							<div class="mb-1 flex items-center gap-2">
								<h3 class="text-lg font-semibold tracking-tight text-gray-900 dark:text-gray-100">
									{model.displayName}
								</h3>
								{#if index === 0 && model.isRouter && !isActive}
									<span
										class="rounded-full border border-gray-200 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:text-gray-400"
									>
										Default
									</span>
								{/if}
							</div>
							<p class="line-clamp-2 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
								{model.isRouter
									? "Routes your messages to the best model for your request."
									: model.description || "-"}
							</p>
						</div>
					</a>
				{/each}
			</div>
		</div>
	</div>
</div>
