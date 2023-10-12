<script lang="ts">
	import { PUBLIC_APP_NAME, PUBLIC_VERSION } from "$env/static/public";
	import { PUBLIC_ANNOUNCEMENT_BANNERS } from "$env/static/public";
	import { PUBLIC_APP_DESCRIPTION } from "$env/static/public";
	import Logo from "$lib/components/icons/Logo.svelte";
	import { createEventDispatcher } from "svelte";
	import IconChevron from "$lib/components/icons/IconChevron.svelte";
	import CarbonArrowUpRight from "~icons/carbon/arrow-up-right";
	import AnnouncementBanner from "../AnnouncementBanner.svelte";
	import ModelsModal from "../ModelsModal.svelte";
	import type { Model } from "$lib/types/Model";
	import ModelCardMetadata from "../ModelCardMetadata.svelte";
	import type { LayoutData } from "../../../routes/$types";
	import { findCurrentModel } from "$lib/utils/models";

	export let currentModel: Model;
	export let settings: LayoutData["settings"];
	export let models: Model[];

	let isModelsModalOpen = false;

	$: currentModelMetadata = findCurrentModel(models, settings.activeModel);

	const announcementBanners = PUBLIC_ANNOUNCEMENT_BANNERS
		? JSON.parse(PUBLIC_ANNOUNCEMENT_BANNERS)
		: [];

	const dispatch = createEventDispatcher<{ message: string }>();
</script>

<div class="my-auto grid gap-8 lg:grid-cols-3">
	<div class="lg:col-span-1">
		<div>
			<div class="mb-3 flex items-center text-2xl font-semibold">
				<Logo classNames="mr-1 flex-none" />
				{PUBLIC_APP_NAME}
				<div
					class="ml-3 flex h-6 items-center rounded-lg border border-gray-100 bg-gray-50 px-2 text-base text-gray-400 dark:border-gray-700/60 dark:bg-gray-800"
				>
					v{PUBLIC_VERSION}
				</div>
			</div>
			<p class="text-base text-gray-600 dark:text-gray-400">
				{PUBLIC_APP_DESCRIPTION ||
					"Making the community's best AI chat models available to everyone."}
			</p>
		</div>
	</div>
	<div class="lg:col-span-2 lg:pl-24">
		{#each announcementBanners as banner}
			<AnnouncementBanner classNames="mb-4" title={banner.title}>
				<a
					target="_blank"
					href={banner.linkHref}
					class="mr-2 flex items-center underline hover:no-underline"
					><CarbonArrowUpRight class="mr-1.5 text-xs" /> {banner.linkTitle}</a
				>
			</AnnouncementBanner>
		{/each}

		{#if isModelsModalOpen}
			<ModelsModal {settings} {models} on:close={() => (isModelsModalOpen = false)} />
		{/if}
		<div class="overflow-hidden rounded-xl border dark:border-gray-800">
			<div class="flex p-3">
				<div>
					<div class="text-sm text-gray-600 dark:text-gray-400">Current Model</div>
					<div class="font-semibold">{currentModel.displayName}</div>
				</div>
				{#if models.length > 1}
					<button
						type="button"
						on:click={() => (isModelsModalOpen = true)}
						class="btn ml-auto flex h-7 w-7 self-start rounded-full bg-gray-100 p-1 text-xs hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:hover:bg-gray-600"
						><IconChevron /></button
					>
				{/if}
			</div>
			<ModelCardMetadata variant="dark" model={currentModel} />
		</div>
	</div>
	{#if currentModelMetadata.promptExamples}
		<div class="lg:col-span-3 lg:mt-6">
			<p class="mb-3 text-gray-600 dark:text-gray-300">Examples</p>
			<div class="grid gap-3 lg:grid-cols-3 lg:gap-5">
				{#each currentModelMetadata.promptExamples as example}
					<button
						type="button"
						class="rounded-xl border bg-gray-50 p-2.5 text-gray-600 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 sm:p-4"
						on:click={() => dispatch("message", example.prompt)}
					>
						{example.title}
					</button>
				{/each}
			</div>
		</div>{/if}
</div>
