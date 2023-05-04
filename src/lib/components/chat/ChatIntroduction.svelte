<script lang="ts">
	import { PUBLIC_DISABLE_INTRO_TILES, PUBLIC_VERSION } from "$env/static/public";
	import Logo from "$lib/components/icons/Logo.svelte";
	import { createEventDispatcher } from "svelte";
	import CarbonEarth from "~icons/carbon/earth";
	import CarbonArrowUpRight from "~icons/carbon/arrow-up-right";
	import IconChevron from "$lib/components/icons/IconChevron.svelte";
	import AnnouncementBanner from "../AnnouncementBanner.svelte";
	import ModelsModal from "../ModelsModal.svelte";
	import type { Model } from "$lib/types/Model";
	import ModelCardMetadata from "../ModelCardMetadata.svelte";

	export let currentModel: Model;
	export let models: Array<Model>;

	let isModelsModalOpen = false;

	const dispatch = createEventDispatcher<{ message: string }>();
</script>

<div class="my-auto grid gap-8 lg:grid-cols-3">
	<div class="lg:col-span-1">
		<div>
			<div class="mb-3 flex items-center text-2xl font-semibold">
				<Logo classNames="mr-1 text-yellow-400 text-4xl" />
				HuggingChat
				{#if typeof PUBLIC_VERSION !== "undefined"}
					<div
						class="ml-3 flex h-6 items-center rounded-lg border border-gray-100 bg-gray-50 px-2 text-base text-gray-400 dark:border-gray-700/60 dark:bg-gray-800"
					>
						v{PUBLIC_VERSION}
					</div>
				{/if}
			</div>
			<p class="text-base text-gray-600 dark:text-gray-400">
				Making the community's best AI chat models available to everyone.
			</p>
		</div>
	</div>
	<div class="lg:col-span-2 lg:pl-24">
		<AnnouncementBanner classNames="mb-4" title="bigcode/starmodel is now available">
			<button
				type="button"
				on:click={() => (isModelsModalOpen = true)}
				class="mr-2 flex items-center underline hover:no-underline"
				><IconChevron classNames="mr-1" /> Switch model</button
			>
		</AnnouncementBanner>
		{#if isModelsModalOpen}
			<ModelsModal {currentModel} {models} on:close={() => (isModelsModalOpen = false)} />
		{/if}
		<div class="overflow-hidden rounded-xl border dark:border-gray-800">
			<div class="flex p-3">
				<div>
					<div class="text-sm text-gray-600 dark:text-gray-400">Current Model</div>
					<div class="font-semibold">{currentModel.displayName}</div>
				</div>
				<button
					type="button"
					on:click={() => (isModelsModalOpen = true)}
					class="btn ml-auto flex h-7 w-7 self-start rounded-full bg-white p-1 text-xs hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:hover:bg-gray-600"
					><IconChevron /></button
				>
			</div>
			<ModelCardMetadata
				variant="dark"
				modelUrl={currentModel.modelUrl}
				datasetUrl={currentModel.datasetUrl}
				websiteUrl={currentModel.websiteUrl}
			/>
		</div>
	</div>
	{#if PUBLIC_DISABLE_INTRO_TILES !== "true"}
		<div class="lg:col-span-3 lg:mt-12">
			<p class="mb-3 text-gray-600 dark:text-gray-300">Examples</p>
			<div class="grid gap-3 lg:grid-cols-3 lg:gap-5">
				<button
					type="button"
					class="rounded-xl border bg-gray-50 p-2.5 text-gray-600 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 sm:p-4"
					on:click={() =>
						dispatch(
							"message",
							"As a restaurant owner, write a professional email to the supplier to get these products every week: \n\n- Wine (x10)\n- Eggs (x24)\n- Bread (x12)"
						)}
				>
					"Write an email from bullet list"
				</button>
				<button
					type="button"
					class="rounded-xl border bg-gray-50 p-2.5 text-gray-600 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 sm:p-4"
					on:click={() =>
						dispatch(
							"message",
							"Code a basic snake game in python, give explanations for each step."
						)}
				>
					"Code a snake game"
				</button>
				<button
					type="button"
					class="rounded-xl border bg-gray-50 p-2.5 text-gray-600 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 sm:p-4"
					on:click={() => dispatch("message", "How do I make a delicious lemon cheesecake?")}
				>
					"Assist in a task"
				</button>
			</div>
		</div>
	{/if}
</div>
