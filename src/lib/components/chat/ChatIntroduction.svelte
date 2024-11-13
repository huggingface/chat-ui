<script lang="ts">
	import { env as envPublic } from "$env/dynamic/public";
	import Logo from "$lib/components/icons/Logo.svelte";
	import { createEventDispatcher } from "svelte";
	import IconGear from "~icons/bi/gear-fill";
	import AnnouncementBanner from "../AnnouncementBanner.svelte";
	import type { Model } from "$lib/types/Model";
	import ModelCardMetadata from "../ModelCardMetadata.svelte";
	import { base } from "$app/paths";
	import JSON5 from "json5";
	import type { PromptExample } from "$lib/server/promptExamples";

	import CarbonImage from "~icons/carbon/image";
	import CarbonTools from "~icons/carbon/tools";

	export let currentModel: Model;
	export let promptExamples: PromptExample[];

	const announcementBanners = envPublic.PUBLIC_ANNOUNCEMENT_BANNERS
		? JSON5.parse(envPublic.PUBLIC_ANNOUNCEMENT_BANNERS)
		: [];

	const dispatch = createEventDispatcher<{
		message: {
			prompt: string;
			file?: File | string;
			tool?: string;
		};
	}>();

	const prompts = promptExamples
		.filter((prompt: PromptExample) => prompt?.models?.includes(currentModel.id) ?? true)
		.filter(Boolean)
		.sort(() => Math.random() - 0.5)
		.slice(0, 3) as PromptExample[];
</script>

<div class="my-auto grid gap-8 lg:grid-cols-3">
	<div class="lg:col-span-1">
		<div>
			<div class="mb-3 flex items-center text-2xl font-semibold">
				<Logo classNames="mr-1 flex-none" />
				{envPublic.PUBLIC_APP_NAME}
				<div
					class="ml-3 flex h-6 items-center rounded-lg border border-gray-100 bg-gray-50 px-2 text-base text-gray-400 dark:border-gray-700/60 dark:bg-gray-800"
				>
					v{envPublic.PUBLIC_VERSION}
				</div>
			</div>
			<p class="text-base text-gray-600 dark:text-gray-400">
				{envPublic.PUBLIC_APP_DESCRIPTION ||
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
					class="mr-2 flex items-center underline hover:no-underline">{banner.linkTitle}</a
				>
			</AnnouncementBanner>
		{/each}
		<div class="overflow-hidden rounded-xl border dark:border-gray-800">
			<div class="flex p-3">
				<div>
					<div class="text-sm text-gray-600 dark:text-gray-400">Current Model</div>
					<div class="flex items-center gap-1.5 font-semibold max-sm:text-smd">
						{#if currentModel.logoUrl}
							<img
								class=" overflown aspect-square size-4 rounded border dark:border-gray-700"
								src={currentModel.logoUrl}
								alt=""
							/>
						{:else}
							<div class="size-4 rounded border border-transparent bg-gray-300 dark:bg-gray-800" />
						{/if}
						{currentModel.displayName}
					</div>
				</div>
				<a
					href="{base}/settings/{currentModel.id}"
					aria-label="Settings"
					class="btn ml-auto flex h-7 w-7 self-start rounded-full bg-gray-100 p-1 text-xs hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:hover:bg-gray-600"
					><IconGear /></a
				>
			</div>
			<ModelCardMetadata variant="dark" model={currentModel} />
		</div>
	</div>
	{#if prompts && prompts.length > 0}
		<div class="lg:col-span-3 lg:mt-6">
			<p class="mb-3 text-sm text-gray-500 dark:text-gray-400">Examples</p>
			<div class="grid gap-3 lg:grid-cols-3 lg:gap-5">
				{#each prompts as example}
					<button
						type="button"
						class="flex w-full max-w-full items-center gap-2 rounded-xl border bg-gray-50 p-3 text-gray-600 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 max-xl:text-sm xl:p-3.5"
						class:multimodal={example.type === "multimodal"}
						class:tool={example.type === "tool"}
						on:click={() =>
							dispatch("message", {
								prompt: example.prompt,
								file: example?.fileUrl ?? undefined,
								tool: example?.toolId ?? undefined,
							})}
					>
						{#if example.type === "multimodal"}
							<CarbonImage class="min-w-6 text-lg text-blue-700 dark:text-blue-500" />
						{:else if example.type === "tool"}
							<CarbonTools class="min-w-6 text-lg text-purple-700 dark:text-purple-500" />
						{/if}
						<span class="ml-2 flex w-full flex-col items-start">
							<span class="text-md text-left">{example.title}</span>
						</span>
					</button>
				{/each}
			</div>
		</div>
	{/if}
	<div class="h-40 sm:h-24" />
</div>

<style lang="postcss">
	.multimodal {
		@apply border-blue-500/20 bg-blue-500/20 hover:bg-blue-500/30;
	}
	.tool {
		@apply border-purple-500/20 bg-purple-500/20 hover:bg-purple-500/30;
	}
</style>
