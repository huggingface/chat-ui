<script lang="ts">
	import type { PageData } from "./$types";

	import { PUBLIC_APP_ASSETS, PUBLIC_ORIGIN } from "$env/static/public";
	import { isHuggingChat } from "$lib/utils/isHuggingChat";

	import { goto } from "$app/navigation";
	import { base } from "$app/paths";
	import { page } from "$app/stores";

	import CarbonAdd from "~icons/carbon/add";

	export let data: PageData;

	let selectedModel = $page.url.searchParams.get("modelId") ?? "";

	const onModelChange = (e: Event) => {
		const newUrl = new URL($page.url);
		if ((e.target as HTMLSelectElement).value === "") {
			newUrl.searchParams.delete("modelId");
		} else {
			newUrl.searchParams.set("modelId", (e.target as HTMLSelectElement).value);
		}
		goto(newUrl);
	};
</script>

<svelte:head>
	{#if isHuggingChat}
		<title>HuggingChat - Assistants</title>
		<meta property="og:title" content="HuggingChat - Assistants" />
		<meta property="og:type" content="link" />
		<meta
			property="og:description"
			content="Browse HuggingChat assistants made by the community."
		/>
		<meta
			property="og:image"
			content="{PUBLIC_ORIGIN ||
				$page.url.origin}{base}/{PUBLIC_APP_ASSETS}/assistants-thumbnail.png"
		/>
		<meta property="og:url" content={$page.url.href} />
	{/if}
</svelte:head>

<div class="scrollbar-custom mr-1 h-full overflow-y-auto py-12 md:py-24">
	<div class="pt-42 mx-auto flex flex-col px-5 xl:w-[60rem] 2xl:w-[64rem]">
		<div class="flex items-center">
			<h1 class="text-2xl font-bold">Assistants</h1>
			<div class="5 ml-1.5 rounded-lg text-xxs uppercase text-gray-500 dark:text-gray-500">
				beta
			</div>
		</div>
		<h3 class="text-gray-500">Browse popular assistants made by the community</h3>
		<div class="mt-6 flex justify-between gap-2 max-sm:flex-col sm:items-center">
			<select
				class="mt-1 h-[34px] rounded-lg border border-gray-300 bg-gray-50 px-2 text-sm text-gray-900 focus:border-blue-700 focus:ring-blue-700 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
				bind:value={selectedModel}
				on:change={onModelChange}
			>
				<option value="">All models</option>
				{#each data.models.filter((model) => !model.unlisted) as model}
					<option value={model.name}>{model.name}</option>
				{/each}
			</select>

			<a
				href={`${base}/settings/assistants/new`}
				class="flex items-center gap-1 whitespace-nowrap rounded-lg border bg-white py-1 pl-1.5 pr-2.5 shadow-sm hover:bg-gray-50 hover:shadow-none dark:border-gray-600 dark:bg-gray-700 dark:hover:bg-gray-700"
			>
				<CarbonAdd />Create New assistant
			</a>
		</div>
		<div class="mt-10 grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
			{#each data.assistants as assistant}
				<a
					href="{base}/assistant/{assistant._id}"
					class="flex flex-col items-center justify-center overflow-hidden text-balance rounded-xl border bg-gray-50/50 px-4 py-6 text-center shadow hover:bg-gray-50 hover:shadow-inner max-sm:px-4 sm:h-64 sm:pb-4 dark:border-gray-800/70 dark:bg-gray-950/20 dark:hover:bg-gray-950/40"
				>
					{#if assistant.avatar}
						<img
							src="{base}/settings/assistants/{assistant._id}/avatar.jpg"
							alt="Avatar"
							class="mb-2 aspect-square size-12 flex-none rounded-full object-cover sm:mb-6 sm:size-20"
						/>
					{:else}
						<div
							class="mb-2 flex aspect-square size-12 flex-none items-center justify-center rounded-full bg-gray-300 text-2xl font-bold uppercase text-gray-500 sm:mb-6 sm:size-20 dark:bg-gray-800"
						>
							{assistant.name[0]}
						</div>
					{/if}
					<h3
						class="mb-2 line-clamp-2 max-w-full break-words text-center text-[.8rem] font-semibold leading-snug sm:text-sm"
					>
						{assistant.name}
					</h3>
					<p class="line-clamp-4 text-xs text-gray-700 sm:line-clamp-2 dark:text-gray-400">
						{assistant.description}
					</p>
					{#if assistant.createdByName}
						<p class="mt-auto pt-2 text-xs text-gray-400 dark:text-gray-500">
							Created by <a
								class="hover:underline"
								href="https://hf.co/{assistant.createdByName}"
								target="_blank"
							>
								{assistant.createdByName}
							</a>
						</p>
					{/if}
				</a>
			{:else}
				No assistants found
			{/each}
		</div>
	</div>
</div>
